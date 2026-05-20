import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';

export const maxDuration = 60;
import { preprocessMessage, extractCustomerInfo, getChatResponse } from '@/lib/openai';
import { createDocument, listDocuments, updateDocument } from '@/lib/appwrite';
import { normalizeToWhatsAppMarkdown } from '@/lib/whatsapp-format';
import { loadTravelKnowledge } from '@/lib/travel-knowledge';
import {
  enforceSafeUrlsInReply,
  getBotRoutePolicyPromptBlock,
  sanitizeWebsiteSnippetsForBot,
  sanitizeWebsiteUrlForBot,
} from '@/lib/whatsapp-bot-routing';
import {
  getGreetingMenuText,
  PRIMARY_QUICK_MENU_OPTIONS,
} from '@/lib/whatsapp-workflow';

const BRIDGE_SHARED_SECRET = process.env.BRIDGE_SHARED_SECRET || '';
const BRIDGE_INSTANCE_KEY = (
  process.env.BRIDGE_INSTANCE_KEY || 'oracle-bridge-primary-2026'
).trim();
const WEBSITE_FALLBACK_URL =
  process.env.TRAVENTIONS_WEBSITE_URL || 'https://traventions-ai.vercel.app';

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
  PRIMARY_QUICK_MENU_OPTIONS[0],
  PRIMARY_QUICK_MENU_OPTIONS[1],
  PRIMARY_QUICK_MENU_OPTIONS[2],
] as const;

function isGreetingMessage(text: string) {
  const normalized = text.trim().toLowerCase();
  return /^(hi|hello|hey|hlo|helo|namaste|yo|good morning|good afternoon|good evening)$/.test(
    normalized
  );
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
  void teamId;
  void phone;
  return false;
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

async function saveLead(params: {
  teamId: string;
  phone: string;
  customer: { $id: string; name?: string; email?: string };
  intent?: string;
  notes?: string;
}) {
  const { teamId, phone, customer, intent, notes } = params;
  const name = customer.name || null;
  const email = customer.email || null;

  const existing = await listDocuments('leads', [
    Query.equal('teamId', teamId),
    Query.equal('phone', phone),
    Query.orderDesc('$createdAt'),
    Query.limit(1),
  ]).catch(() => ({ documents: [] }));

  const now = new Date().toISOString();
  const existingLead = existing.documents[0] as { $id?: string } | undefined;

  if (existingLead?.$id) {
    await updateDocument('leads', existingLead.$id, {
      name: name || undefined,
      email: email || undefined,
      notes: notes || undefined,
      status: 'new',
      lastContactedAt: now,
      updatedAt: now,
    }).catch(() => {});
  } else {
    await createDocument('leads', {
      teamId,
      phone,
      name,
      email,
      source: 'whatsapp',
      status: 'new',
      notes: notes || (intent ? `Service interest: ${intent}` : null),
      lastContactedAt: now,
      createdAt: now,
      updatedAt: now,
    }).catch(() => {});
  }
}

async function buildReply(params: {
  teamId: string;
  customerId: string;
  userMessage: string;
  correctedText: string;
  intent: string;
  customerName?: string;
}) {
  const [historyResult, businessConfigResult] = await Promise.all([
    listDocuments('conversations', [
      Query.equal('teamId', params.teamId),
      Query.equal('customerId', params.customerId),
      Query.orderDesc('$createdAt'),
      Query.limit(20),
    ]).catch(() => ({ documents: [] })),
    listDocuments('business_configs', [Query.equal('teamId', params.teamId), Query.limit(1)]).catch(
      () => ({ documents: [] })
    ),
  ]);

  const historyRows = historyResult.documents as Array<{
    role?: string;
    message?: string | null;
  }>;

  const history = historyRows
    .slice(0, 14)
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

  const knowledge = await loadTravelKnowledge(params.teamId, params.correctedText).catch(() => ({
    databaseSnippets: [] as string[],
    hasPackageData: false,
    bestWebsiteUrl: sanitizeWebsiteUrlForBot(WEBSITE_FALLBACK_URL),
    bestWebsiteTitle: 'Traventions',
    websiteSnippets: [] as string[],
  }));

  const safeWebsiteUrl = sanitizeWebsiteUrlForBot(knowledge.bestWebsiteUrl || WEBSITE_FALLBACK_URL);
  const safeSnippets = sanitizeWebsiteSnippetsForBot(knowledge.websiteSnippets);

  if (!process.env.OPENAI_API_KEY) {
    return {
      reply: 'Welcome to Traventions! Our team will get back to you shortly.',
      quickMenu: false,
      quickMenuOptions: null,
    };
  }

  const systemPrompt = [
    businessConfig?.openaiSystemPrompt || '',
    `You are Sini, a warm and knowledgeable travel assistant for Traventions (a full-service travel agency in India).`,
    firstAssistantReply
      ? 'Start this reply with "Welcome to Traventions!".'
      : 'Do not repeat the welcome greeting.',
    getBotRoutePolicyPromptBlock(),
    `
YOUR ROLE:
Help customers with: holidays, flights, hotels, transfers, forex, visa, insurance, and MICE.
Converse naturally — ask one or two questions at a time, never overwhelm.

CONVERSATION APPROACH:
- First understand what the customer needs (holiday, flight, hotel, etc.)
- For holidays: ask destination, travel month, number of travellers, number of nights, budget range
- For flights: ask origin city, destination city, travel date, number of passengers
- For hotels: ask city, check-in & check-out dates, star preference
- Once you have enough details, collect: customer name, WhatsApp number, preferred callback time
- Confirm: "Our team will call you back shortly to finalise everything!"

RULES:
- All amounts in INR only — never USD or $
- Do NOT use markdown links [text](url) — WhatsApp cannot render them. Use plain URLs only.
- Keep replies concise (under 180 words)
- Never invent specific prices — say "our team will share the exact quote"
- Website & packages: ${safeWebsiteUrl}`,
    knowledge.databaseSnippets.length
      ? `\nPACKAGE KNOWLEDGE:\n${knowledge.databaseSnippets.slice(0, 6).map((v, i) => `${i + 1}. ${v}`).join('\n')}`
      : '',
    safeSnippets.length
      ? `\nWEBSITE PAGES:\n${safeSnippets.slice(0, 4).map((v, i) => `${i + 1}. ${v}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();

  const response = await getChatResponse(params.correctedText, systemPrompt, history);
  const safe = enforceSafeUrlsInReply(enforceInrReply(response));

  return {
    reply: normalizeToWhatsAppMarkdown(safe),
    quickMenu: false,
    quickMenuOptions: null,
  };
}

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
    if (BRIDGE_INSTANCE_KEY) {
      const providedInstanceKey = request.headers.get('x-bridge-instance-key') || '';
      if (providedInstanceKey !== BRIDGE_INSTANCE_KEY) {
        return unauthorized();
      }
    }

    const body = (await request.json()) as BridgeIncomingBody;
    const from = body.from?.trim();
    const text = body.message?.trim();
    const eventType = body.eventType || 'incoming_message';

    if (!from) {
      return NextResponse.json({ error: 'Missing required field: from' }, { status: 400 });
    }

    const teamId = resolveTeamId(body.teamId);
    let customer = (await findOrCreateCustomer(from, teamId, body.name)) as {
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
      return NextResponse.json({ error: 'Missing required field: message' }, { status: 400 });
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

    // Fast path: greeting — no AI needed
    if (isGreetingMessage(text)) {
      const greetingReply = normalizeToWhatsAppMarkdown(
        getGreetingMenuText(customer.name || body.name || null)
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

    // Run typo correction and customer info extraction in parallel — both awaited
    // so Vercel doesn't kill them when the response is sent.
    let intent = 'other';
    let correctedText = text;
    if (process.env.OPENAI_API_KEY) {
      const [preprocessed, extractedInfo] = await Promise.all([
        preprocessMessage(text, `Team: ${teamId}, channel: whatsapp_web`)
          .catch(() => ({ correctedText: text, intent: 'other' })),
        extractCustomerInfo(text).catch(() => ({} as { name?: string; email?: string; phone?: string })),
      ]);
      correctedText = preprocessed.correctedText;
      intent = preprocessed.intent;
      if (correctedText !== text) {
        console.log(`[WA Bridge] Typo corrected: "${text}" → "${correctedText}"`);
      }
      // Update customer record with extracted name/email
      const updates: Record<string, string> = {};
      if (extractedInfo?.name && !customer.name) updates.name = extractedInfo.name;
      if (extractedInfo?.email && isValidEmail(extractedInfo.email) && !customer.email) updates.email = extractedInfo.email;
      if (Object.keys(updates).length) {
        updateDocument('customers', customer.$id, { ...updates, updatedAt: new Date().toISOString() }).catch(() => {});
        customer = { ...customer, ...updates };
      }
    }

    // Save lead synchronously whenever we have a name (phone always available as `from`)
    if (customer.name) {
      await saveLead({
        teamId,
        phone: from,
        customer,
        intent,
        notes: `WhatsApp inquiry. ${correctedText.slice(0, 300)}`,
      }).catch(() => {});
    }

    const built = await buildReply({
      teamId,
      customerId: customer.$id,
      userMessage: text,
      correctedText,
      intent,
      customerName: customer.name || body.name || undefined,
    }).catch(() => ({
      reply: 'Welcome to Traventions! Our team will get back to you shortly.',
      quickMenu: false,
      quickMenuOptions: null as string[] | null,
    }));

    const reply = built.reply;

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
    return NextResponse.json({ error: 'Failed to process bridge message' }, { status: 500 });
  }
}
