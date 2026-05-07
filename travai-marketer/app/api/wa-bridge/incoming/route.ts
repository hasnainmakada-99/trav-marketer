import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { classifyIntent, extractCustomerInfo, getChatResponse } from '@/lib/openai';
import { createDocument, listDocuments, updateDocument } from '@/lib/appwrite';
import { normalizeToWhatsAppMarkdown } from '@/lib/whatsapp-format';
import {
  buildRuleBasedItinerary,
  isPackageIntent,
  loadTravelKnowledge,
} from '@/lib/travel-knowledge';

const BRIDGE_SHARED_SECRET = process.env.BRIDGE_SHARED_SECRET || '';
const WEBSITE_FALLBACK_URL =
  process.env.TRAVENTIONS_WEBSITE_URL || 'https://traventions-ai.vercel.app';
const HUMAN_HANDOVER_MINUTES = Number(process.env.WA_HUMAN_HANDOVER_MINUTES || '15');

interface BridgeIncomingBody {
  from?: string;
  name?: string;
  message?: string;
  messageId?: string;
  timestamp?: string | number;
  teamId?: string;
}

function resolveTeamId(preferred?: string) {
  if (preferred && preferred.trim().length > 0) {
    return preferred.trim();
  }
  return process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'system';
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized bridge request' }, { status: 401 });
}

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

  // Human takeover is active only when latest staff message is newer than latest AI message
  // and still within a short active window. This prevents permanent AI suppression.
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

async function findOrCreateCustomer(phone: string, teamId: string, name?: string) {
  const existing = await listDocuments('customers', [
    Query.equal('teamId', teamId),
    Query.equal('phone', phone),
    Query.limit(1),
  ]);

  if (existing.documents.length > 0) {
    const customer = existing.documents[0] as { $id: string; name?: string; email?: string };
    if (name && !customer.name) {
      return updateDocument('customers', customer.$id, {
        name,
        updatedAt: new Date().toISOString(),
      });
    }
    return customer;
  }

  return createDocument('customers', {
    teamId,
    phone,
    name: name || null,
    source: 'whatsapp_web',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function buildReply(params: {
  teamId: string;
  customerId: string;
  userMessage: string;
  intent: string;
}) {
  const [historyResult, knowledge, businessConfigResult] = await Promise.all([
    listDocuments('conversations', [
      Query.equal('teamId', params.teamId),
      Query.equal('customerId', params.customerId),
      Query.orderDesc('$createdAt'),
      Query.limit(20),
    ]),
    loadTravelKnowledge(params.teamId, params.userMessage),
    listDocuments('business_configs', [Query.equal('teamId', params.teamId), Query.limit(1)]).catch(
      () => ({ documents: [] })
    ),
  ]);

  const historyRows = historyResult.documents as Array<{
    role?: string;
    message?: string | null;
  }>;

  const history = historyRows
    .slice(0, 5)
    .reverse()
    .map((row) => ({
      role: (row.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: row.message || '[media]',
    }));

  const assistantMessages = historyRows.filter((row) => row.role === 'assistant').length;
  const firstAssistantReply = assistantMessages === 0;
  const businessConfig = businessConfigResult.documents[0] as
    | { openaiSystemPrompt?: string }
    | undefined;
  const databaseKnowledge = knowledge.databaseSnippets.length
    ? knowledge.databaseSnippets.map((item, i) => `${i + 1}. ${item}`).join('\n')
    : 'No relevant package or itinerary data found in database.';
  const packageIntent = isPackageIntent(params.userMessage, params.intent);
  const websiteKnowledge = knowledge.websiteSnippets.length
    ? knowledge.websiteSnippets.map((item, i) => `${i + 1}. ${item}`).join('\n')
    : `1. Traventions Home — ${WEBSITE_FALLBACK_URL}`;

  const systemPrompt =
    `${businessConfig?.openaiSystemPrompt || ''}\n\n` +
    `You are Traventions' WhatsApp assistant.
Business name must appear as "Traventions" in customer-facing replies.
${firstAssistantReply ? 'Start this reply with: "Welcome to Traventions!".' : 'Do not repeat the welcome line again in every reply.'}
Current intent: ${params.intent}.
If user asks for packages/itineraries/pricing:
- First use database knowledge below.
- If DB package data is missing, still provide a practical sample itinerary based on user budget/days/destination.
- After answering, include the most relevant page link from the website index.
Keep tone warm, concise, and practical.
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

Package intent detected: ${packageIntent ? 'yes' : 'no'}
Package data available in DB: ${knowledge.hasPackageData ? 'yes' : 'no'}
Best website page for this query: ${knowledge.bestWebsiteTitle} (${knowledge.bestWebsiteUrl})

DATABASE KNOWLEDGE:
${databaseKnowledge}

WEBSITE PAGE INDEX:
${websiteKnowledge}`.trim();

  if (!process.env.OPENAI_API_KEY) {
    if (packageIntent) {
      return normalizeToWhatsAppMarkdown(buildRuleBasedItinerary(params.userMessage));
    }
    return normalizeToWhatsAppMarkdown(
      'Welcome to Traventions! Thanks for your message. Our team will get back to you shortly.'
    );
  }

  const response = await getChatResponse(params.userMessage, systemPrompt, history);
  if (packageIntent) {
    const preferredUrl = knowledge.bestWebsiteUrl || WEBSITE_FALLBACK_URL;
    const alreadyHasUrl = response.includes(preferredUrl);
    if (!alreadyHasUrl) {
      return normalizeToWhatsAppMarkdown(
        `${response}\n\nFor latest live packages and booking, visit ${preferredUrl}.`
      );
    }
  }
  return normalizeToWhatsAppMarkdown(response);
}

/**
 * POST /api/wa-bridge/incoming
 * Receives incoming WhatsApp-Web messages from a local/oracle bridge.
 * Returns AI reply text; bridge is responsible for sending it back on WhatsApp.
 */
export async function POST(request: NextRequest) {
  try {
    if (!BRIDGE_SHARED_SECRET) {
      return NextResponse.json(
        { error: 'BRIDGE_SHARED_SECRET is not configured on Vercel.' },
        { status: 500 }
      );
    }

    const providedSecret = request.headers.get('x-bridge-secret');
    if (providedSecret !== BRIDGE_SHARED_SECRET) {
      return unauthorized();
    }

    const body = (await request.json()) as BridgeIncomingBody;
    const from = body.from?.trim();
    const text = body.message?.trim();

    if (!from || !text) {
      return NextResponse.json(
        { error: 'Missing required fields: from, message' },
        { status: 400 }
      );
    }

    const teamId = resolveTeamId(body.teamId);
    let customer = (await findOrCreateCustomer(from, teamId, body.name)) as {
      $id: string;
      name?: string;
      email?: string;
      teamId?: string;
    };

    if (process.env.OPENAI_API_KEY) {
      const extractedInfo = await extractCustomerInfo(text);
      if (extractedInfo.name && !customer.name) {
        customer = (await updateDocument('customers', customer.$id, {
          name: extractedInfo.name,
          email: extractedInfo.email || customer.email || null,
          updatedAt: new Date().toISOString(),
        })) as {
          $id: string;
          name?: string;
          email?: string;
          teamId?: string;
        };
      }
    }

    await createDocument('conversations', {
      teamId,
      customerId: customer.$id,
      phone: from,
      role: 'user',
      message: text,
      messageType: 'text',
      sentBy: 'customer',
      metaMessageId: body.messageId || null,
      deliveryStatus: 'received',
      createdAt: new Date().toISOString(),
    });

    const handover = await hasHumanTakeover(teamId, from);
    if (handover) {
      return NextResponse.json({
        success: true,
        teamId,
        customerId: customer.$id,
        shouldReply: false,
        suppressed: 'human_handover',
      });
    }

    const intent = process.env.OPENAI_API_KEY
      ? await classifyIntent(text, `Team: ${teamId}, channel: whatsapp_web`)
      : 'other';

    const reply = await buildReply({
      teamId,
      customerId: customer.$id,
      userMessage: text,
      intent,
    });

    await createDocument('conversations', {
      teamId,
      customerId: customer.$id,
      phone: from,
      role: 'assistant',
      message: reply,
      messageType: 'text',
      sentBy: 'ai',
      metaMessageId: null,
      deliveryStatus: 'bridged',
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      teamId,
      customerId: customer.$id,
      intent,
      shouldReply: true,
      reply,
    });
  } catch (error) {
    console.error('[WA Bridge Incoming] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process bridge message' },
      { status: 500 }
    );
  }
}
