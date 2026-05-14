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
import {
  enforceSafeUrlsInReply,
  getBotRoutePolicyPromptBlock,
  resolveSafeRouteChoice,
  sanitizeWebsiteSnippetsForBot,
  sanitizeWebsiteUrlForBot,
} from '@/lib/whatsapp-bot-routing';
import {
  detectWorkflowIntent,
  getGreetingMenuText,
  getWorkflowStarterReply,
  getWorkflowSystemPromptBlock,
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

function mapQuickMenuSelectionToIntentText(text: string) {
  const detected = detectWorkflowIntent(text);
  const starter = getWorkflowStarterReply(detected);
  return starter || null;
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
  // Bridge bot must keep responding continuously in production.
  // Manual handover suppression can be reintroduced later behind explicit controls.
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
      bestWebsiteUrl: sanitizeWebsiteUrlForBot(WEBSITE_FALLBACK_URL),
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
  const workflowIntent = detectWorkflowIntent(params.userMessage, params.intent);
  const databaseKnowledge = knowledge.databaseSnippets.length
    ? knowledge.databaseSnippets.map((item, i) => `${i + 1}. ${item}`).join('\n')
    : 'No relevant package or itinerary data found in database.';
  const packageIntent =
    workflowIntent === 'plan_holiday' || isPackageIntent(params.userMessage, params.intent);
  const safeWebsiteSnippets = sanitizeWebsiteSnippetsForBot(knowledge.websiteSnippets);
  const routeChoice = resolveSafeRouteChoice({
    message: params.userMessage,
    classifiedIntent: params.intent,
    websiteUrlHint: knowledge.bestWebsiteUrl,
  });
  const safeBestWebsiteUrl = sanitizeWebsiteUrlForBot(knowledge.bestWebsiteUrl);
  const websiteKnowledge = safeWebsiteSnippets.length
    ? safeWebsiteSnippets.map((item, i) => `${i + 1}. ${item}`).join('\n')
    : `1. Traventions Home - ${WEBSITE_FALLBACK_URL}`;

  const systemPrompt =
    `${businessConfig?.openaiSystemPrompt || ''}\n\n` +
    `You are Traventions' WhatsApp assistant.
Business name must appear as "Traventions" in customer-facing replies.
${firstAssistantReply ? 'Start this reply with: "Welcome to Traventions!".' : 'Do not repeat the welcome line again in every reply.'}
Current intent: ${params.intent}.
${getBotRoutePolicyPromptBlock()}
${getWorkflowSystemPromptBlock(workflowIntent)}
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
Best safe website page for this query: ${knowledge.bestWebsiteTitle} (${safeBestWebsiteUrl})
Preferred route for this query: ${routeChoice.url}${routeChoice.loginRequired ? ' (login required)' : ''}

DATABASE KNOWLEDGE:
${databaseKnowledge}

WEBSITE PAGE INDEX:
${websiteKnowledge}`.trim();

  if (!process.env.OPENAI_API_KEY) {
    if (packageIntent) {
      return {
        reply: normalizeToWhatsAppMarkdown(buildRuleBasedItinerary(params.userMessage)),
        quickMenu: false,
        quickMenuOptions: null,
      };
    }
    return {
      reply: normalizeToWhatsAppMarkdown(
        'Welcome to Traventions! Thanks for your message. Our team will get back to you shortly.'
      ),
      quickMenu: false,
      quickMenuOptions: null,
    };
  }

  if (isGreetingMessage(params.userMessage)) {
    const quickMenuReply = normalizeToWhatsAppMarkdown(
      getGreetingMenuText(params.customerName || null)
    );
    return {
      reply: quickMenuReply,
      quickMenu: true,
      quickMenuOptions: [...SUPPORT_MENU_OPTIONS],
    };
  }

  const quickSelectionPrompt = mapQuickMenuSelectionToIntentText(params.userMessage);
  if (quickSelectionPrompt) {
    return {
      reply: normalizeToWhatsAppMarkdown(quickSelectionPrompt),
      quickMenu: false,
      quickMenuOptions: null,
    };
  }

  const response = await getChatResponse(params.userMessage, systemPrompt, history);
  const inrSafeResponse = enforceSafeUrlsInReply(enforceInrReply(response));
  if (packageIntent) {
    const preferredUrl = routeChoice.url || safeBestWebsiteUrl || sanitizeWebsiteUrlForBot(WEBSITE_FALLBACK_URL);
    const alreadyHasUrl = inrSafeResponse.includes(preferredUrl);
    if (!alreadyHasUrl) {
      return {
        reply: normalizeToWhatsAppMarkdown(
          `${inrSafeResponse}\n\nFor latest live packages and booking, visit ${preferredUrl}.`
        ),
        quickMenu: false,
        quickMenuOptions: null,
      };
    }
  }
  return {
    reply: normalizeToWhatsAppMarkdown(inrSafeResponse),
    quickMenu: false,
    quickMenuOptions: null,
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
      return NextResponse.json(
        { error: 'Missing required field: from' },
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

    // Fast path: greeting messages never need AI classification or website crawl.
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
