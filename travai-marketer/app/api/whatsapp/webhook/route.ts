import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import {
  extractMessage,
  extractStatus,
  parseWhatsAppWebhook,
  sendWhatsAppMessage,
  verifyWebhookToken,
} from '@/lib/whatsapp';
import { getChatResponse, classifyIntent, extractCustomerInfo } from '@/lib/openai';
import { createDocument, listDocuments, updateDocument } from '@/lib/appwrite';
import { normalizeToWhatsAppMarkdown } from '@/lib/whatsapp-format';
import {
  buildRuleBasedItinerary,
  isPackageIntent,
  loadTravelKnowledge,
} from '@/lib/travel-knowledge';

// Verify webhook token from Meta
const WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'travai_secure_token_2024';
const WEBSITE_FALLBACK_URL =
  process.env.TRAVENTIONS_WEBSITE_URL || 'https://traventions-ai.vercel.app';
const HUMAN_HANDOVER_MINUTES = Number(process.env.WA_HUMAN_HANDOVER_MINUTES || '15');

async function hasHumanTakeover(teamId: string, phone: string) {
  const rows = await listDocuments('conversations', [
    Query.equal('teamId', teamId),
    Query.equal('phone', phone),
    Query.orderDesc('$createdAt'),
    Query.limit(100),
  ]);

  let latestStaffTs = 0;
  let latestAiTs = 0;

  for (const doc of rows.documents as Array<{
    sentBy?: string;
    createdAt?: string;
    $createdAt?: string;
  }>) {
    const ts = new Date(doc.createdAt || doc.$createdAt || 0).getTime();
    if (!Number.isFinite(ts) || ts <= 0) continue;

    if (doc.sentBy === 'staff' && ts > latestStaffTs) {
      latestStaffTs = ts;
    }
    if (doc.sentBy === 'ai' && ts > latestAiTs) {
      latestAiTs = ts;
    }
  }

  if (!(latestStaffTs > 0 && latestStaffTs > latestAiTs)) {
    return false;
  }

  const safeMinutes =
    Number.isFinite(HUMAN_HANDOVER_MINUTES) && HUMAN_HANDOVER_MINUTES > 0
      ? HUMAN_HANDOVER_MINUTES
      : 45;
  const handoverWindowMs = safeMinutes * 60 * 1000;
  return Date.now() - latestStaffTs <= handoverWindowMs;
}

/**
 * GET /api/whatsapp/webhook
 * Meta's webhook verification endpoint
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    if (mode !== 'subscribe' || !token || !challenge) {
      return NextResponse.json(
        { error: 'Invalid webhook parameters' },
        { status: 400 }
      );
    }

    // Verify the token
    if (!verifyWebhookToken(token, WEBHOOK_VERIFY_TOKEN)) {
      return NextResponse.json(
        { error: 'Invalid verification token' },
        { status: 403 }
      );
    }

    // Return the challenge to complete verification
    return new NextResponse(challenge, { status: 200 });
  } catch (error) {
    console.error('[WhatsApp Webhook] GET Error:', error);
    return NextResponse.json(
      { error: 'Webhook verification failed' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/whatsapp/webhook
 * Receive and process messages from Meta
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate webhook signature (implement X-Hub-Signature verification in production)
    // const signature = request.headers.get('X-Hub-Signature-256');

    // Parse the webhook payload
    const webhook = parseWhatsAppWebhook(body);

    if (!webhook) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const { messages, statuses, phoneNumberId } = webhook;

    // Process incoming messages
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        await processIncomingMessage(msg, phoneNumberId || '');
      }
    }

    // Process message statuses (delivered, read, failed)
    if (statuses && statuses.length > 0) {
      for (const status of statuses) {
        await processMessageStatus(status, phoneNumberId || '');
      }
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('[WhatsApp Webhook] POST Error:', error);
    return NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500 }
    );
  }
}

/**
 * Process an incoming message from WhatsApp
 */
async function processIncomingMessage(
  message: Parameters<typeof extractMessage>[0],
  webhookPhoneNumberId: string
) {
  try {
    const incoming = extractMessage(message);
    if (!incoming || !incoming.phone) {
      console.warn('[WhatsApp] Skipping message: missing sender phone');
      return;
    }

    const phone = incoming.phone;
    const type = incoming.type || 'text';
    const text = 'text' in incoming ? (incoming.text || '') : '';
    const messageId = incoming.messageId || null;
    const teamId = await resolveTeamIdByPhoneNumberId(webhookPhoneNumberId);

    console.log(`📨 Incoming ${type} message from ${phone}:`, text || messageId);

    // Find or create customer record
    let customer = await findOrCreateCustomer(phone, teamId);

    // Extract customer info from message (name, email, etc.)
    if (text && process.env.OPENAI_API_KEY) {
      const extractedInfo = await extractCustomerInfo(text);
      if (extractedInfo.name && !customer.name) {
        customer = await updateDocument('customers', customer.$id, {
          name: extractedInfo.name,
          email: extractedInfo.email,
          phone: extractedInfo.phone || phone,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Save the conversation message
    await createDocument('conversations', {
      teamId,
      customerId: customer.$id,
      phone: phone,
      role: 'user',
      message: text || `[${type}]`,
      messageType: type,
      sentBy: 'customer',
      metaMessageId: messageId || null,
      deliveryStatus: 'received',
      createdAt: new Date().toISOString(),
    });

    if (!text) {
      return;
    }

    const handover = await hasHumanTakeover(teamId, phone);
    if (handover) {
      console.log(`[WhatsApp] AI suppressed for ${phone} due to staff takeover`);
      return;
    }

    // Classify the intent only when OpenAI key exists, otherwise fall back.
    const businessContext = `Team: ${teamId}, channel: whatsapp`;
    const intent = process.env.OPENAI_API_KEY
      ? await classifyIntent(text, businessContext)
      : 'other';

    // Generate an AI response for normal conversational intents.
    if (['inquiry', 'booking', 'followup', 'other'].includes(intent)) {
      await generateAndSendResponse(
        customer,
        text,
        phone,
        intent,
        webhookPhoneNumberId,
        teamId
      );
    } else if (intent === 'complaint') {
      // Route complaints to staff
      await createDocument('leads', {
        teamId,
        phone: phone,
        name: customer.name,
        email: customer.email,
        source: 'whatsapp',
        status: 'new',
        notes: `Customer complaint: ${text}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('[WhatsApp] Error processing message:', error);
  }
}

/**
 * Process a message status update (delivery, read, failed)
 */
async function processMessageStatus(
  status: Parameters<typeof extractStatus>[0],
  webhookPhoneNumberId: string
) {
  try {
    const parsed = extractStatus(status);
    if (!parsed || !parsed.messageId) {
      return;
    }

    const { phone, messageId, status: msgStatus } = parsed;
    const teamId = await resolveTeamIdByPhoneNumberId(webhookPhoneNumberId);

    console.log(`📦 Message ${messageId} from ${phone}: ${msgStatus}`);

    // Find the conversation with this messageId
    const conversations = await listDocuments('conversations', [
      Query.equal('teamId', teamId),
      Query.equal('metaMessageId', messageId),
      Query.limit(1),
    ]);

    if (conversations.documents.length > 0) {
      const convo = conversations.documents[0];
      await updateDocument('conversations', convo.$id, {
        deliveryStatus: msgStatus,
      });
    }
  } catch (error) {
    console.error('[WhatsApp] Error processing status:', error);
  }
}

/**
 * Find or create a customer record
 */
async function findOrCreateCustomer(phone: string, teamId: string) {
  try {
    const result = await listDocuments('customers', [
      Query.equal('teamId', teamId),
      Query.equal('phone', phone),
      Query.limit(1),
    ]);

    if (result.documents.length > 0) {
      return result.documents[0];
    }

    // Create new customer
    return await createDocument('customers', {
      teamId,
      phone: phone,
      source: 'whatsapp',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[WhatsApp] Error finding/creating customer:', error);
    throw error;
  }
}

/**
 * Generate an AI response and send it via WhatsApp
 */
async function generateAndSendResponse(
  customer: { $id: string; teamId?: string; name?: string; email?: string },
  userMessage: string,
  phone: string,
  intent: string,
  webhookPhoneNumberId: string,
  teamId: string
) {
  try {
    const resolvedTeamId =
      teamId || customer.teamId || process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'system';

    // Get recent conversation history
    const convos = await listDocuments('conversations', [
      Query.equal('teamId', resolvedTeamId),
      Query.equal('customerId', customer.$id),
      Query.orderDesc('$createdAt'),
      Query.limit(10),
    ]);

    const historyRows = convos.documents as Array<{ role?: string; message?: string }>;
    const history = historyRows
      .slice(0, 5)
      .reverse()
      .map((c) => ({
        role: (c.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: c.message || '[media]',
      }));

    const businessConfigResult = await listDocuments('business_configs', [
      Query.equal('teamId', resolvedTeamId),
      Query.limit(1),
    ]);
    const businessConfig = businessConfigResult.documents[0] as
      | { businessName?: string; openaiSystemPrompt?: string }
      | undefined;

    const packageIntent = isPackageIntent(userMessage, intent);
    const knowledge = await loadTravelKnowledge(resolvedTeamId, userMessage);

    // Generate AI response
    const systemPrompt =
      `${businessConfig?.openaiSystemPrompt || ''}\n\n` +
      `You are Traventions' WhatsApp assistant.
Mention Traventions in customer-facing replies.
For first meaningful assistant reply in a thread, start with "Welcome to Traventions!".
For package/pricing questions:
- First use database knowledge for exact known details.
- If DB package data is missing, still provide a practical sample itinerary.
- Then include the most relevant website page from the index.
Use only WhatsApp-supported formatting:
- Bold: *text*
- Italic: _text_
- Strikethrough: ~text~
- Bullets: * item
- Numbered lists: 1. item
- Quote: > text
- Inline code: \`code\`
- Code block: \`\`\`code\`\`\`
Do not use markdown headings like #, ##, ###.
Current intent: ${intent}
Package intent: ${packageIntent ? 'yes' : 'no'}
Package data available: ${knowledge.hasPackageData ? 'yes' : 'no'}
Best website page: ${knowledge.bestWebsiteTitle} (${knowledge.bestWebsiteUrl})
DATABASE KNOWLEDGE:
${knowledge.databaseSnippets.length ? knowledge.databaseSnippets.map((v, i) => `${i + 1}. ${v}`).join('\n') : 'No relevant snippets found.'}
WEBSITE PAGE INDEX:
${knowledge.websiteSnippets.length ? knowledge.websiteSnippets.map((v, i) => `${i + 1}. ${v}`).join('\n') : `1. Traventions — ${WEBSITE_FALLBACK_URL}`}`.trim();

    const response = process.env.OPENAI_API_KEY
      ? await getChatResponse(userMessage, systemPrompt, history)
      : packageIntent
      ? buildRuleBasedItinerary(userMessage)
      : 'Welcome to Traventions! Thanks for your message. Our team will get back to you shortly.';

    const responseWithFallback =
      packageIntent && !response.includes(knowledge.bestWebsiteUrl || WEBSITE_FALLBACK_URL)
        ? `${response}\n\nFor latest packages, please visit ${knowledge.bestWebsiteUrl || WEBSITE_FALLBACK_URL}.`
        : response;
    const waFormattedResponse = normalizeToWhatsAppMarkdown(responseWithFallback);

    // Send via WhatsApp Cloud API (Meta)
    const phoneNumberId = webhookPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const whatsappToken = process.env.WHATSAPP_TOKEN || '';

    if (!phoneNumberId || !whatsappToken) {
      throw new Error('Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN');
    }

    const sendResult = await sendWhatsAppMessage({
      phoneNumberId,
      recipientPhone: phone,
      message: waFormattedResponse,
      whatsappToken,
    });

    // Save the outgoing message with the actual Meta message ID
    await createDocument('conversations', {
      teamId: resolvedTeamId,
      customerId: customer.$id,
      phone: phone,
      role: 'assistant',
      message: waFormattedResponse,
      messageType: 'text',
      sentBy: 'ai',
      metaMessageId: sendResult.messageId || null,
      deliveryStatus: sendResult.success ? 'sent' : 'failed',
      createdAt: new Date().toISOString(),
    });

    if (sendResult.success) {
      console.log(`✅ AI response sent to ${phone}`);
    } else {
      console.error(`❌ Failed to send AI response:`, sendResult.error);
    }
  } catch (error) {
    console.error('[WhatsApp] Error generating/sending response:', error);
  }
}

async function resolveTeamIdByPhoneNumberId(phoneNumberId: string): Promise<string> {
  if (!phoneNumberId) {
    return process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'system';
  }

  const configs = await listDocuments('business_configs', [
    Query.equal('whatsappPhoneNumberId', phoneNumberId),
    Query.limit(1),
  ]);

  if (configs.documents.length > 0) {
    const teamId = (configs.documents[0] as { teamId?: string }).teamId;
    if (teamId) {
      return teamId;
    }
  }

  return process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'system';
}
