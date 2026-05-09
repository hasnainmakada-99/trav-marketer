import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';

export const maxDuration = 60;
import { classifyIntent, extractCustomerInfo, getChatResponse } from '@/lib/openai';
import { createDocument, listDocuments, updateDocument } from '@/lib/appwrite';
import { normalizeToWhatsAppMarkdown } from '@/lib/whatsapp-format';
import {
  buildRuleBasedItinerary,
  isPackageIntent,
  loadTravelKnowledge,
} from '@/lib/travel-knowledge';

const BRIDGE_SHARED_SECRET = process.env.BRIDGE_SHARED_SECRET || '';
const BRIDGE_INSTANCE_KEY =
  (process.env.BRIDGE_INSTANCE_KEY || 'oracle-bridge-lock-v1').trim();
const WEBSITE_FALLBACK_URL =
  process.env.TRAVENTIONS_WEBSITE_URL || 'https://traventions-ai.vercel.app';
const HUMAN_HANDOVER_MINUTES = Number(process.env.WA_HUMAN_HANDOVER_MINUTES || '15');

const YCLOUD_API_KEY = process.env.YCLOUD_API_KEY || '';
const YCLOUD_FROM_NUMBER = process.env.YCLOUD_FROM_NUMBER || '919428122003';
const YCLOUD_GREETING_IMAGE_URL =
  process.env.YCLOUD_GREETING_IMAGE_URL || 'https://trav-marketer.vercel.app/sini.png';

interface BridgeIncomingBody {
  from?: string;
  name?: string;
  message?: string;
  messageId?: string;
  timestamp?: string | number;
  teamId?: string;
  eventType?: 'incoming_message' | 'staff_outgoing';
}

const SUPPORT_MENU_OPTIONS = [
  'Hotel',
  'Holiday Package',
  'Flights',
] as const;

function isGreetingMessage(text: string) {
  const normalized = text.trim().toLowerCase();
  return /^(hi|hello|hey|hlo|helo|namaste|yo|good morning|good afternoon|good evening)$/.test(
    normalized
  );
}

function mapQuickMenuSelectionToIntentText(text: string) {
  const normalized = text.trim().toLowerCase();
  const compact = normalized.replace(/\s+/g, ' ');
  if (compact === '1' || compact.includes('svc_1') || compact.includes('svc_hotel') || compact.includes('hotel')) {
    return 'Customer selected Hotel. Ask destination and budget in INR. Use exact database pricing only; if missing, ask clarifying questions instead of inventing ranges.';
  }
  if (
    compact === '2' ||
    compact.includes('svc_2') ||
    compact.includes('svc_holiday') ||
    compact.includes('holiday') ||
    compact.includes('package')
  ) {
    return 'Customer selected Holiday Package. Ask destination + budget + days and suggest best matching packages/itinerary.';
  }
  if (compact === '3' || compact.includes('svc_3') || compact.includes('svc_flights') || compact.includes('flight')) {
    return 'Customer selected Flights. Ask origin, destination, dates, travellers and share flight-planning guidance.';
  }
  if (compact === '4' || compact.includes('svc_4') || compact.includes('svc_transfer') || compact.includes('transfer')) {
    return 'Customer selected Airport Transfer. Ask route, date/time, passengers, and luggage details.';
  }
  if (compact === '5' || compact.includes('svc_5') || compact.includes('svc_status') || compact.includes('status')) {
    return 'Customer selected Booking Status. Ask for booking reference and registered phone/email.';
  }
  return null;
}

function enforceInrReply(text: string) {
  let out = text;
  out = out.replace(/\bUSD\b/gi, 'INR');
  out = out.replace(/\$(\s?\d)/g, 'INR $1');
  out = out.replace(/₹\s*/g, 'INR ');
  return out;
}

function isValidEmail(value?: string | null): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function sendYCloudGreeting(toPhone: string, customerName?: string): Promise<boolean> {
  if (!YCLOUD_API_KEY) return false;

  const to = toPhone.startsWith('+') ? toPhone : `+${toPhone}`;
  const from = YCLOUD_FROM_NUMBER.startsWith('+') ? YCLOUD_FROM_NUMBER : `+${YCLOUD_FROM_NUMBER}`;
  const name = customerName ? customerName.split(' ')[0] : null;
  const bodyText = name
    ? `Hey ${name}, thank you for reaching out Traventions...!!!\n\nI'm Sini, your Trav-Ai Buddy 😊\n\nPlease select the below service to assist you better`
    : `Hey, thank you for reaching out Traventions...!!!\n\nI'm Sini, your Trav-Ai Buddy 😊\n\nPlease select the below service to assist you better`;

  try {
    const res = await fetch('https://api.ycloud.com/v2/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
      body: JSON.stringify({
        from,
        to,
        type: 'whatsapp',
        whatsapp: {
          type: 'interactive',
          interactive: {
            type: 'button',
            header: { type: 'image', image: { link: YCLOUD_GREETING_IMAGE_URL } },
            body: { text: bodyText },
            action: {
              buttons: [
                { type: 'reply', reply: { id: 'svc_hotel',   title: 'Hotel 🏨' } },
                { type: 'reply', reply: { id: 'svc_holiday', title: 'Holiday Package' } },
                { type: 'reply', reply: { id: 'svc_flights', title: 'Flights ✈️' } },
              ],
            },
          },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[YCloud] Greeting failed:', res.status, body);
      return false;
    }
    console.log('[YCloud] Greeting sent to', to);
    return true;
  } catch (err) {
    console.error('[YCloud] Greeting error:', err);
    return false;
  }
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

function isAuthorizedBridgeRequest(request: NextRequest) {
  const providedSecret = request.headers.get('x-bridge-secret');
  if (providedSecret !== BRIDGE_SHARED_SECRET) return false;
  const providedInstanceKey = request.headers.get('x-bridge-instance-key') || '';
  if (BRIDGE_INSTANCE_KEY && providedInstanceKey !== BRIDGE_INSTANCE_KEY) return false;
  return true;
}

async function hasHumanTakeover(teamId: string, phone: string) {
  try {
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
  } catch {
    return false;
  }
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
  customerName?: string;
}) {
  const [historyResult, knowledge, businessConfigResult] = await Promise.all([
    listDocuments('conversations', [
      Query.equal('teamId', params.teamId),
      Query.equal('customerId', params.customerId),
      Query.orderDesc('$createdAt'),
      Query.limit(20),
    ]).catch(() => ({ documents: [] })),
    loadTravelKnowledge(params.teamId, params.userMessage).catch(() => ({
      databaseSnippets: [] as string[],
      hasPackageData: false,
      bestWebsiteUrl: WEBSITE_FALLBACK_URL,
      bestWebsiteTitle: 'Traventions',
      websiteSnippets: [] as string[],
      diagnostics: { collectionsScanned: [], collectionDocCounts: {}, crawledPages: 0 },
    })),
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
    : `1. Traventions Home - ${WEBSITE_FALLBACK_URL}`;

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
Currency and pricing rules:
- Currency must be INR only.
- Do not mention USD or dollar symbols.
- Use exact numeric pricing from database snippets when available.
- If exact DB pricing is not found, explicitly say pricing is on request and ask follow-up questions.
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
      return {
        reply: normalizeToWhatsAppMarkdown(buildRuleBasedItinerary(params.userMessage)),
        quickMenu: false,
      };
    }
    return {
      reply: normalizeToWhatsAppMarkdown(
        'Welcome to Traventions! Thanks for your message. Our team will get back to you shortly.'
      ),
      quickMenu: false,
    };
  }

  if (isGreetingMessage(params.userMessage)) {
    const namePart = params.customerName ? ` ${params.customerName}` : '';
    const quickMenuReply = normalizeToWhatsAppMarkdown(
      `Welcome to Traventions!${namePart}\n\nI'm your travel support assistant.\nPlease choose a service:\n1. Hotel\n2. Holiday Package\n3. Flights\n\nFor Airport Transfer or Booking Status, just type it directly.`
    );
    return {
      reply: quickMenuReply,
      quickMenu: true,
      quickMenuOptions: [...SUPPORT_MENU_OPTIONS],
    };
  }

  const quickSelectionPrompt = mapQuickMenuSelectionToIntentText(params.userMessage);
  const effectiveUserMessage = quickSelectionPrompt || params.userMessage;
  const response = await getChatResponse(effectiveUserMessage, systemPrompt, history);
  const inrSafeResponse = enforceInrReply(response);
  if (packageIntent) {
    const preferredUrl = knowledge.bestWebsiteUrl || WEBSITE_FALLBACK_URL;
    const alreadyHasUrl = inrSafeResponse.includes(preferredUrl);
    if (!alreadyHasUrl) {
      return {
        reply: normalizeToWhatsAppMarkdown(
          `${inrSafeResponse}\n\nFor latest live packages and booking, visit ${preferredUrl}.`
        ),
        quickMenu: false,
      };
    }
  }
  return {
    reply: normalizeToWhatsAppMarkdown(inrSafeResponse),
    quickMenu: false,
  };
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

    if (!isAuthorizedBridgeRequest(request)) {
      return unauthorized();
    }

    const body = (await request.json()) as BridgeIncomingBody;
    const from = body.from?.trim();
    const text = body.message?.trim();
    const eventType = body.eventType || 'incoming_message';

    if (!from) {
      return NextResponse.json(
        { error: 'Missing required field: from' },
        { status: 400 }
      );
    }

    const teamId = resolveTeamId(body.teamId);
    const customer = (await findOrCreateCustomer(from, teamId, body.name)) as {
      $id: string;
      name?: string;
      email?: string;
      teamId?: string;
    };

    if (eventType === 'staff_outgoing') {
      if (!text) {
        return NextResponse.json({ success: true, shouldReply: false, ignored: 'empty_staff_event' });
      }
      await createDocument('conversations', {
        teamId,
        customerId: customer.$id,
        phone: from,
        role: 'assistant',
        message: text,
        messageType: 'text',
        sentBy: 'staff',
        metaMessageId: body.messageId || null,
        deliveryStatus: 'manual',
        createdAt: new Date().toISOString(),
      });
      return NextResponse.json({
        success: true,
        teamId,
        customerId: customer.$id,
        shouldReply: false,
        suppressed: 'human_handover',
      });
    }

    if (!text) {
      return NextResponse.json(
        { error: 'Missing required field: message' },
        { status: 400 }
      );
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

    // Fast path: greeting messages — send YCloud interactive template (image + buttons).
    if (isGreetingMessage(text)) {
      const customerName = customer.name || body.name || undefined;
      const ycloudSent = await sendYCloudGreeting(from, customerName);

      if (ycloudSent) {
        // YCloud sent the rich greeting; tell bridge not to send its own text reply.
        createDocument('conversations', {
          teamId,
          customerId: customer.$id,
          phone: from,
          role: 'assistant',
          message: 'Sini greeting template sent via YCloud',
          messageType: 'interactive',
          sentBy: 'ai',
          metaMessageId: null,
          deliveryStatus: 'ycloud',
          createdAt: new Date().toISOString(),
        }).catch(() => {});
        return NextResponse.json({
          success: true,
          teamId,
          customerId: customer.$id,
          intent: 'greeting',
          shouldReply: false,
          suppressed: 'ycloud_template_sent',
        });
      }

      // YCloud unavailable — fall back to plain-text quick menu.
      const namePart = customerName ? ` ${customerName.split(' ')[0]}` : '';
      const greetingReply = normalizeToWhatsAppMarkdown(
        `Hey${namePart}, thank you for reaching out Traventions!\n\nI'm Sini, your Trav-Ai Buddy 😊\nPlease choose a service:\n1. Hotel\n2. Holiday Package\n3. Flights\n\nFor Airport Transfer or Booking Status, just type it directly.`
      );
      createDocument('conversations', {
        teamId,
        customerId: customer.$id,
        phone: from,
        role: 'assistant',
        message: greetingReply.slice(0, 2000),
        messageType: 'text',
        sentBy: 'ai',
        metaMessageId: null,
        deliveryStatus: 'bridged',
        createdAt: new Date().toISOString(),
      }).catch(() => {});
      return NextResponse.json({
        success: true,
        teamId,
        customerId: customer.$id,
        intent: 'greeting',
        shouldReply: true,
        reply: greetingReply,
        quickMenu: true,
        quickMenuOptions: [...SUPPORT_MENU_OPTIONS],
      });
    }

    // Non-critical: extract name/email in background — never block the reply path.
    if (process.env.OPENAI_API_KEY) {
      extractCustomerInfo(text)
        .then(async (extractedInfo) => {
          if (extractedInfo?.name && !customer.name) {
            const validEmail = isValidEmail(extractedInfo.email)
              ? extractedInfo.email
              : customer.email || null;
            await updateDocument('customers', customer.$id, {
              name: extractedInfo.name,
              email: validEmail,
              updatedAt: new Date().toISOString(),
            }).catch(() => {});
          }
        })
        .catch(() => {});
    }

    const intent = process.env.OPENAI_API_KEY
      ? await classifyIntent(text, `Team: ${teamId}, channel: whatsapp_web`)
      : 'other';

    const built = await buildReply({
      teamId,
      customerId: customer.$id,
      userMessage: text,
      intent,
      customerName: customer.name || body.name || undefined,
    }).catch(() => ({
      reply: 'Welcome to Traventions! Our team will get back to you shortly.',
      quickMenu: false,
      quickMenuOptions: null as string[] | null,
    }));
    const reply = built.reply;

    // Fire-and-forget: never let a DB write failure block the reply to the customer.
    createDocument('conversations', {
      teamId,
      customerId: customer.$id,
      phone: from,
      role: 'assistant',
      message: reply.slice(0, 2000),
      messageType: 'text',
      sentBy: 'ai',
      metaMessageId: null,
      deliveryStatus: 'bridged',
      createdAt: new Date().toISOString(),
    }).catch((err: unknown) => {
      console.error('[WA Bridge Incoming] Failed to save AI reply to DB:', err);
    });

    return NextResponse.json({
      success: true,
      teamId,
      customerId: customer.$id,
      intent,
      shouldReply: true,
      reply,
      quickMenu: Boolean(built.quickMenu),
      quickMenuOptions: built.quickMenuOptions || null,
    });
  } catch (error) {
    console.error('[WA Bridge Incoming] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process bridge message' },
      { status: 500 }
    );
  }
}
