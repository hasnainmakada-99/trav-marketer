import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import {
  extractMessage,
  extractStatus,
  parseWhatsAppWebhook,
  verifyWebhookToken,
} from '@/lib/whatsapp';
import {
  sendYCloudTextMessage,
  sendYCloudReplyButtonsMessage,
  showYCloudTypingIndicator,
} from '@/lib/whatsapp-ycloud';
import { getChatResponse, extractCustomerInfo, preprocessMessage, extractWorkflowSlots } from '@/lib/openai';
import { createDocument, listDocuments, updateDocument } from '@/lib/appwrite';
import { normalizeToWhatsAppMarkdown } from '@/lib/whatsapp-format';
import { createHmac, timingSafeEqual } from 'crypto';
import { loadTravelKnowledge } from '@/lib/travel-knowledge';
import {
  buildPhoneVariants,
  coerceLeadStatus,
  deriveLeadStatus,
  isConversionIntent,
  mergeLeadStatus,
} from '@/lib/crm';
import { sendCallbackEmails } from '@/lib/email';
import {
  enforceSafeUrlsInReply,
  getBotRoutePolicyPromptBlock,
  sanitizeWebsiteSnippetsForBot,
  sanitizeWebsiteUrlForBot,
} from '@/lib/whatsapp-bot-routing';
import {
  getGreetingIntroText,
  getGreetingMenuText,
  PRIMARY_QUICK_MENU_OPTIONS,
  resolveWorkflowState,
  buildWorkflowReply,
  getWorkflowSystemPromptBlock,
  buildConversationMemoryBlock,
  buildLeadNotes,
  buildConfirmedWorkflowReply,
  isQuestionLike,
  type WorkflowIntent,
  type WorkflowStage,
} from '@/lib/whatsapp-workflow';

// Verify webhook token from Meta
const WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'travai_secure_token_2024';
const WEBSITE_FALLBACK_URL =
  process.env.TRAVENTIONS_WEBSITE_URL || 'https://traventions-ai.vercel.app';
const HUMAN_HANDOVER_MINUTES = Number(process.env.WA_HUMAN_HANDOVER_MINUTES || '15');
const DISABLE_HUMAN_HANDOVER = process.env.WA_DISABLE_HUMAN_HANDOVER === 'true';
const YCLOUD_WEBHOOK_SECRET = (process.env.YCLOUD_WEBHOOK_SECRET || '')
  .trim()
  .replace(/^['"]+|['"]+$/g, '');
const YCLOUD_ENFORCE_SIGNATURE = process.env.YCLOUD_ENFORCE_SIGNATURE === 'true';
const RECENT_INBOUND_TTL_MS = 2 * 60 * 1000;
const RECENT_AI_DUPLICATE_WINDOW_MS = 45 * 1000;
const CLASSIFY_TIMEOUT_MS = Number(process.env.WA_CLASSIFY_TIMEOUT_MS || '1200');
const KNOWLEDGE_TIMEOUT_MS = Number(process.env.WA_KNOWLEDGE_TIMEOUT_MS || '1800');
const TYPING_REFRESH_MS = Number(process.env.WA_TYPING_REFRESH_MS || '2200');
const TYPING_MAX_MS = Number(process.env.WA_TYPING_MAX_MS || '45000');
const recentInboundKeys = new Map<string, number>();
const GREETING_BUTTONS = [
  { id: 'svc_1', title: PRIMARY_QUICK_MENU_OPTIONS[0] },
  { id: 'svc_2', title: PRIMARY_QUICK_MENU_OPTIONS[1] },
  { id: 'svc_3', title: PRIMARY_QUICK_MENU_OPTIONS[2] },
] as const;
const TRAVEL_SALES_INTENTS: WorkflowIntent[] = ['plan_holiday', 'flights', 'hotels'];
const TRAVEL_KEYWORDS_REGEX =
  /\b(travel|trip|tour|holiday|holidays|package|packages|itinerary|destination|visa|forex|insurance|airport transfer|transfer|hotel|hotels|stay|resort|flight|flights|ticket|fare|booking|callback)\b/i;
const OFF_TOPIC_KEYWORDS_REGEX =
  /\b(weather|temperature|rain|sports|cricket|football|ipl|stocks?|share market|crypto|bitcoin|ethereum|politics|election|movie|movies|song|songs|joke|memes?|programming|code|debug|python|javascript|java|c\+\+|exam|homework|math|recipe|cooking|gym|workout|astrology|zodiac)\b/i;

function isGreetingMessage(text: string) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(hi|hello|hey|hlo|helo|namaste|yo|good morning|good afternoon|good evening)$/.test(
    normalized
  );
}

function isTravelSalesIntent(intent: WorkflowIntent): boolean {
  return TRAVEL_SALES_INTENTS.includes(intent);
}

function isHardOffTopicInput(message: string, workflowIntent: WorkflowIntent): boolean {
  const normalized = normalizeTextForDedupe(message || '');
  if (!normalized) return false;
  if (isTravelSalesIntent(workflowIntent)) return false;
  if (TRAVEL_KEYWORDS_REGEX.test(normalized)) return false;
  return OFF_TOPIC_KEYWORDS_REGEX.test(normalized);
}

function buildOffTopicReply(name?: string | null): string {
  const prefix = name ? `${name.split(' ')[0]}, ` : '';
  return (
    `${prefix}I can help only with travel planning and bookings.\n\n` +
    `Please choose one option to continue:\n\n` +
    `1. Plan a Holiday\n2. Flights\n3. Hotels`
  );
}

function shouldEnforceDatabaseFirst(params: {
  workflowIntent: WorkflowIntent;
  workflowStage: WorkflowStage;
  userMessage: string;
}): boolean {
  if (!isTravelSalesIntent(params.workflowIntent)) return false;
  if (params.workflowStage === 'show_packages') return true;
  return /\b(package|packages|itinerary|price|pricing|cost|budget|offer|deals?|hotel options?|flight options?|fare)\b/i.test(
    params.userMessage
  );
}

function getGreetingImageUrl(requestUrl: string) {
  const configured = (process.env.WA_GREETING_IMAGE_URL || '').trim();
  if (configured) {
    return configured;
  }
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
  if (appUrl) {
    return `${appUrl.replace(/\/+$/, '')}/sini.png`;
  }
  const fallbackOrigin = new URL(requestUrl).origin;
  return `${fallbackOrigin}/sini.png`;
}

function verifyYCloudSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const parts = signatureHeader
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2);
  const signatureHex = parts.find((part) => part.startsWith('s='))?.slice(2);
  if (!timestamp || !signatureHex) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedHex = createHmac('sha256', secret).update(signedPayload).digest('hex');
  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(signatureHex, 'hex');
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

function normalizeTextForDedupe(input: string): string {
  return String(input || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(fallback), Math.max(300, timeoutMs));
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function buildInboundDedupeKey(params: {
  teamId: string;
  phone: string;
  messageId: string | null;
  type: string;
  text: string;
}): string {
  const team = String(params.teamId || 'system');
  const phone = String(params.phone || '');
  if (params.messageId) {
    return `mid:${team}:${phone}:${params.messageId}`;
  }
  return `content:${team}:${phone}:${params.type}:${normalizeTextForDedupe(params.text)}`;
}

function wasRecentlyProcessedInbound(key: string): boolean {
  const now = Date.now();
  const expiry = recentInboundKeys.get(key);
  if (!expiry) return false;
  if (expiry <= now) {
    recentInboundKeys.delete(key);
    return false;
  }
  return true;
}

function markInboundProcessed(key: string) {
  const now = Date.now();
  for (const [candidate, expiry] of recentInboundKeys.entries()) {
    if (expiry <= now) {
      recentInboundKeys.delete(candidate);
    }
  }
  recentInboundKeys.set(key, now + RECENT_INBOUND_TTL_MS);
}

async function hasHumanTakeover(teamId: string, phone: string) {
  if (DISABLE_HUMAN_HANDOVER) {
    return false;
  }
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

async function sendViaYCloud(params: {
  phone: string;
  message: string;
}) {
  const apiKey = (process.env.YCLOUD_API_KEY || '').trim();
  const fromPhone = (process.env.YCLOUD_WHATSAPP_FROM || '').trim();
  if (!apiKey || !fromPhone) {
    throw new Error('YCloud send is not configured. Set YCLOUD_API_KEY and YCLOUD_WHATSAPP_FROM.');
  }
  let lastError = 'YCloud send failed';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await sendYCloudTextMessage({
        apiKey,
        fromPhoneE164: fromPhone,
        toPhone: params.phone,
        message: params.message,
      });
      if (result.success) {
        return {
          success: true,
          mode: 'ycloud',
          messageId: result.messageId || null,
        };
      }
      lastError = result.error || lastError;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err || lastError);
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  throw new Error(lastError);
}

async function sendYCloudGreetingExperience(params: {
  phone: string;
  requestUrl: string;
  customerName?: string | null;
}) {
  const apiKey = (process.env.YCLOUD_API_KEY || '').trim();
  const fromPhone = (process.env.YCLOUD_WHATSAPP_FROM || '').trim();
  if (!apiKey || !fromPhone) {
    throw new Error('YCloud send is not configured. Set YCLOUD_API_KEY and YCLOUD_WHATSAPP_FROM.');
  }

  const imageUrl = getGreetingImageUrl(params.requestUrl);
  const introText = getGreetingIntroText(params.customerName || null);
  const menuText = getGreetingMenuText(params.customerName || null);
  const combinedText = `${introText}\n\n${menuText}`;

  const interactiveWithImage = await sendYCloudReplyButtonsMessage({
    apiKey,
    fromPhoneE164: fromPhone,
    toPhone: params.phone,
    bodyText: combinedText,
    buttons: [...GREETING_BUTTONS],
    headerImageUrl: imageUrl,
  });
  if (interactiveWithImage.success) {
    return {
      messageId: interactiveWithImage.messageId || null,
      messageText: combinedText,
      usedInteractiveButtons: true,
      usedHeaderImage: true,
    };
  }

  const interactiveWithoutImage = await sendYCloudReplyButtonsMessage({
    apiKey,
    fromPhoneE164: fromPhone,
    toPhone: params.phone,
    bodyText: combinedText,
    buttons: [...GREETING_BUTTONS],
  });
  if (interactiveWithoutImage.success) {
    return {
      messageId: interactiveWithoutImage.messageId || null,
      messageText: combinedText,
      usedInteractiveButtons: true,
      usedHeaderImage: false,
    };
  }

  const fallbackText = await sendYCloudTextMessage({
    apiKey,
    fromPhoneE164: fromPhone,
    toPhone: params.phone,
    message: combinedText,
  });
  if (!fallbackText.success) {
    throw new Error(
      fallbackText.error ||
        interactiveWithoutImage.error ||
        interactiveWithImage.error ||
        'Failed to send greeting interactive card via YCloud'
    );
  }

  return {
    messageId: fallbackText.messageId || null,
    messageText: combinedText,
    usedInteractiveButtons: false,
    usedHeaderImage: false,
  };
}

async function startYCloudTypingKeepAlive(inboundMessageId: string | null) {
  if (!inboundMessageId) {
    return { stop: async () => {} };
  }
  const apiKey = (process.env.YCLOUD_API_KEY || '').trim();
  if (!apiKey) {
    return { stop: async () => {} };
  }

  const inboundId = String(inboundMessageId || '').trim();
  if (!inboundId) {
    return { stop: async () => {} };
  }

  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const startedAt = Date.now();

  const emitTyping = async () => {
    const typingResult = await showYCloudTypingIndicator({
      apiKey,
      inboundMessageId: inboundId,
    });
    if (!typingResult.success) {
      console.warn('[WhatsApp] Typing indicator failed:', typingResult.error);
    }
  };

  await emitTyping();

  const interval = setInterval(() => {
    if (stopped) return;
    if (Date.now() - startedAt >= Math.max(8000, TYPING_MAX_MS)) {
      stopped = true;
      clearInterval(interval);
      return;
    }
    if (inFlight) return;
    inFlight = emitTyping().finally(() => {
      inFlight = null;
    });
  }, Math.max(1200, TYPING_REFRESH_MS));

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      if (inFlight) {
        await inFlight;
      }
    },
  };
}

async function loadTravelKnowledgeFast(
  teamId: string,
  userMessage: string
): Promise<Awaited<ReturnType<typeof loadTravelKnowledge>>> {
  const fallback: Awaited<ReturnType<typeof loadTravelKnowledge>> = {
    databaseSnippets: [] as string[],
    hasPackageData: false,
    bestWebsiteUrl: sanitizeWebsiteUrlForBot(WEBSITE_FALLBACK_URL),
    bestWebsiteTitle: 'Traventions',
    websiteSnippets: [] as string[],
    diagnostics: {
      collectionsScanned: [] as string[],
      collectionDocCounts: {} as Record<string, number>,
      crawledPages: 0,
    },
  };

  return withTimeout(
    loadTravelKnowledge(teamId, userMessage).catch(() => fallback),
    KNOWLEDGE_TIMEOUT_MS,
    fallback
  );
}

async function sendAutoReply(params: {
  phone: string;
  message: string;
}) {
  return sendViaYCloud({ phone: params.phone, message: params.message });
}

async function saveLead(params: {
  teamId: string;
  phone: string;
  customer: { $id: string; name?: string; email?: string };
  intent?: string;
  notes?: string;
  status?: string;
}) {
  const { teamId, phone, customer, intent, notes, status } = params;
  const name = customer.name || null;
  const email = customer.email || null;

  const existing = await findLatestLead(teamId, phone);

  const now = new Date().toISOString();
  const existingLead = existing.documents[0] as
    | { $id?: string; status?: string; notes?: string | null }
    | undefined;
  const resolvedStatus = mergeLeadStatus(existingLead?.status, status || 'new_lead');
  const nextNotes = notes || existingLead?.notes || (intent ? `Service interest: ${intent}` : null);

  if (existingLead?.$id) {
    await updateDocument('leads', existingLead.$id, {
      name: name || undefined,
      email: email || undefined,
      notes: nextNotes || undefined,
      status: resolvedStatus,
      lastContactedAt: now,
      updatedAt: now,
    }).catch(() => {});
    return { leadId: existingLead.$id, status: resolvedStatus, existed: true as const };
  } else {
    await createDocument('leads', {
      teamId,
      phone,
      name,
      email,
      source: 'whatsapp',
      status: resolvedStatus,
      notes: nextNotes,
      lastContactedAt: now,
      createdAt: now,
      updatedAt: now,
    }).catch(() => {});
    return { leadId: null, status: resolvedStatus, existed: false as const };
  }
}

async function findLatestLead(teamId: string, phone: string) {
  const variants = buildPhoneVariants(phone);
  return listDocuments('leads', [
    Query.equal('teamId', teamId),
    Query.equal('phone', variants.length ? variants : [phone]),
    Query.orderDesc('$createdAt'),
    Query.limit(1),
  ]).catch(() => ({ documents: [] as Array<Record<string, unknown>> }));
}

async function upsertCustomerProfile(params: {
  customerId: string;
  currentName?: string | null;
  currentEmail?: string | null;
  nextName?: string | null;
  nextEmail?: string | null;
}) {
  const payload: Record<string, string> = {};
  if (params.nextName && params.nextName !== params.currentName) {
    payload.name = params.nextName;
  }
  if (params.nextEmail && params.nextEmail !== params.currentEmail) {
    payload.email = params.nextEmail;
  }
  if (Object.keys(payload).length === 0) {
    return null;
  }
  payload.updatedAt = new Date().toISOString();
  return updateDocument('customers', params.customerId, payload).catch(() => null);
}

function buildServiceSummary(intent: string, notes?: string | null) {
  const readableIntent = intent.replace(/_/g, ' ');
  if (notes?.trim()) {
    return `${readableIntent}: ${notes.trim().slice(0, 220)}`;
  }
  return readableIntent;
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
    const rawBody = await request.text();
    const body = rawBody ? JSON.parse(rawBody) : {};

    const ycloudSignature = request.headers.get('YCloud-Signature');
    if (YCLOUD_ENFORCE_SIGNATURE && ycloudSignature && YCLOUD_WEBHOOK_SECRET) {
      const validYCloudSignature = verifyYCloudSignature(
        rawBody || '{}',
        ycloudSignature,
        YCLOUD_WEBHOOK_SECRET
      );
      if (!validYCloudSignature) {
        return NextResponse.json({ error: 'Invalid YCloud webhook signature' }, { status: 401 });
      }
    }

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
        await processIncomingMessage(msg, phoneNumberId || '', request.url);
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
  webhookPhoneNumberId: string,
  requestUrl: string
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

    // Drop messages from the Traventions own number (self-loop) and auto-replies
    const ownPhone = (process.env.YCLOUD_WHATSAPP_FROM || '').replace(/\D/g, '');
    if (ownPhone && phone.replace(/\D/g, '') === ownPhone) {
      console.log(`[WhatsApp] Skipping self-message from own number ${phone}`);
      return;
    }
    const AUTOREPLY_PATTERNS = [
      /reach out to us/i, /thanks for reaching out/i, /out of (office|town)/i,
      /automated (message|reply|response)/i, /do not (reply|respond)/i,
      /this is an? (auto|automated)/i, /unsubscribe/i,
    ];
    if (text && AUTOREPLY_PATTERNS.some(p => p.test(text))) {
      console.log(`[WhatsApp] Skipping auto-reply from ${phone}: "${text.slice(0, 80)}"`);
      return;
    }

    const teamId = await resolveTeamIdByPhoneNumberId(webhookPhoneNumberId);
    const dedupeKey = buildInboundDedupeKey({
      teamId,
      phone,
      messageId,
      type,
      text,
    });

    if (wasRecentlyProcessedInbound(dedupeKey)) {
      console.log(`[WhatsApp] Skipping duplicate inbound (memory cache) ${dedupeKey}`);
      return;
    }

    let existingInbound: { customerId?: string; createdAt?: string; $createdAt?: string } | null = null;
    if (messageId) {
      const existing = await listDocuments('conversations', [
        Query.equal('teamId', teamId),
        Query.equal('phone', phone),
        Query.equal('sentBy', 'customer'),
        Query.equal('metaMessageId', messageId),
        Query.limit(1),
      ]);
      if (existing.documents.length > 0) {
        existingInbound = existing.documents[0] as {
          customerId?: string;
          createdAt?: string;
          $createdAt?: string;
        };
        const inboundTs = new Date(
          existingInbound.createdAt || existingInbound.$createdAt || 0
        ).getTime();
        const existingCustomerId = existingInbound.customerId;

        let hasAiReplyAfterInbound = false;
        if (existingCustomerId && Number.isFinite(inboundTs) && inboundTs > 0) {
          const aiAfterInbound = await listDocuments('conversations', [
            Query.equal('teamId', teamId),
            Query.equal('customerId', existingCustomerId),
            Query.equal('sentBy', 'ai'),
            Query.orderDesc('$createdAt'),
            Query.limit(1),
          ]);
          const latestAi = aiAfterInbound.documents[0] as
            | { createdAt?: string; $createdAt?: string }
            | undefined;
          const latestAiTs = new Date(latestAi?.createdAt || latestAi?.$createdAt || 0).getTime();
          hasAiReplyAfterInbound = Number.isFinite(latestAiTs) && latestAiTs >= inboundTs;
        }

        if (hasAiReplyAfterInbound) {
          console.log(`[WhatsApp] Skipping duplicate inbound messageId=${messageId}`);
          markInboundProcessed(dedupeKey);
          return;
        }

        console.log(
          `[WhatsApp] Reprocessing inbound messageId=${messageId} because no AI reply was found after first receive`
        );
      }
    }

    console.log(`[Incoming] Incoming ${type} message from ${phone}:`, text || messageId);

    // Find or create customer record
    let customer = await findOrCreateCustomer(phone, teamId);

    // Save the conversation message
    if (!existingInbound) {
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
    }
    markInboundProcessed(dedupeKey);

    if (!text) {
      // Non-text message (audio, image, video, sticker) — send a friendly nudge
      const nonTextReply = type === 'audio' || type === 'voice'
        ? '😊 I received your voice note! Unfortunately I can only read text right now. Please type your message and I\'ll be happy to help!'
        : type === 'image' || type === 'video'
          ? '📸 Thanks for sharing! I work best with text messages. Please describe what you need and I\'ll assist you right away 😊'
          : '😊 I work best with text messages. Please type your query and I\'ll help you plan your trip!';

      const handoverCheck = await hasHumanTakeover(teamId, phone);
      if (!handoverCheck) {
        const sendResult = await sendAutoReply({
          phone,
          message: nonTextReply,
        }).catch(() => ({ success: false, messageId: null, mode: 'unknown' }));
        if (sendResult.success) {
          await createDocument('conversations', {
            teamId, customerId: customer.$id, phone,
            role: 'assistant', message: nonTextReply, messageType: 'text',
            sentBy: 'ai', metaMessageId: sendResult.messageId || null,
            deliveryStatus: 'sent', createdAt: new Date().toISOString(),
          });
        }
      }
      return;
    }

    // Extract customer info synchronously (alongside hasHumanTakeover) so lead save
    // happens within the request lifecycle rather than as a detached background promise.
    const [handover, extractedInfo] = await Promise.all([
      hasHumanTakeover(teamId, phone),
      process.env.OPENAI_API_KEY
        ? extractCustomerInfo(text).catch(() => ({} as { name?: string; email?: string; phone?: string }))
        : Promise.resolve({} as { name?: string; email?: string; phone?: string }),
    ]);

    if ((extractedInfo?.name && !customer.name) || (extractedInfo?.email && !customer.email)) {
      const updatedCustomer = await upsertCustomerProfile({
        customerId: customer.$id,
        currentName: customer.name,
        currentEmail: customer.email,
        nextName: customer.name || extractedInfo.name,
        nextEmail: customer.email || extractedInfo.email,
      });
      if (updatedCustomer) {
        customer = {
          ...customer,
          name: customer.name || extractedInfo.name,
          email: customer.email || extractedInfo.email,
        };
      }
    }

    if (handover) {
      console.log(`[WhatsApp] AI suppressed for ${phone} due to staff takeover`);
      return;
    }

    const greetingMessage = isGreetingMessage(text);
    // Preprocess: fix typos via AI + classify intent in one call
    const businessContext = `Team: ${teamId}, channel: whatsapp`;
    let intent = 'other';
    let correctedText = text; // AI-corrected version used for workflow/slot extraction
    if (!greetingMessage && process.env.OPENAI_API_KEY) {
      const preprocessed = await withTimeout(
        preprocessMessage(text, businessContext).catch(() => ({ correctedText: text, intent: 'other' })),
        CLASSIFY_TIMEOUT_MS,
        { correctedText: text, intent: 'other' }
      );
      correctedText = preprocessed.correctedText;
      intent = preprocessed.intent;
      if (correctedText !== text) {
        console.log(`[WhatsApp] Typo corrected: "${text}" → "${correctedText}"`);
      }
    } else if (greetingMessage) {
      intent = 'greeting';
    }

    // Generate AI response for all non-complaint intents.
    if (intent !== 'complaint') {
      await generateAndSendResponse(
        customer,
        text,           // original stored in DB
        correctedText,  // typo-corrected used for logic
        phone,
        intent,
        teamId,
        requestUrl,
        messageId
      );
    } else {
      // Route complaints to staff
      const complaintLead = await findLatestLead(teamId, phone).catch(() => ({ documents: [] }));
      const complaintExisting = complaintLead.documents[0] as { status?: string; $id?: string } | undefined;
      saveLead({
        teamId,
        phone,
        customer,
        intent: 'complaint',
        notes: `Customer complaint: ${text}`,
        status: complaintExisting?.$id ? coerceLeadStatus(complaintExisting.status) : 'new_lead',
      }).catch(() => {});
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

    console.log(`[Status] Message ${messageId} from ${phone}: ${msgStatus}`);

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
    const variants = buildPhoneVariants(phone);
    const result = await listDocuments('customers', [
      Query.equal('teamId', teamId),
      Query.equal('phone', variants.length ? variants : [phone]),
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
  userMessage: string,      // original text — stored in DB
  correctedText: string,    // AI typo-corrected — used for intent/slot logic
  phone: string,
  intent: string,
  teamId: string,
  requestUrl: string,
  inboundMessageId: string | null
) {
  try {
    const resolvedTeamId =
      teamId || customer.teamId || process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'system';
    const existingLeadResult = await findLatestLead(resolvedTeamId, phone);
    const existingLead = existingLeadResult.documents[0] as
      | { $id?: string; status?: string; notes?: string | null }
      | undefined;

    const typingKeepAlive = await startYCloudTypingKeepAlive(inboundMessageId);
    try {

      // Fetch up to 40 messages so both the workflow engine and OpenAI can see
      // the actual recent transcript instead of a very short clipped window.
      const convos = await listDocuments('conversations', [
        Query.equal('teamId', resolvedTeamId),
        Query.equal('customerId', customer.$id),
        Query.orderDesc('$createdAt'),
        Query.limit(40),
      ]);

    const historyRows = convos.documents as Array<{ role?: string; message?: string; sentBy?: string }>;

    // Full chronological history (all 40) — used for workflow state resolution
    const fullHistory = [...historyRows].reverse().map((c) => ({
      role: (c.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: c.message || '[media]',
    }));

    // Remove the current inbound message from the tail (already stored above)
    if (fullHistory.length > 0) {
      const last = fullHistory[fullHistory.length - 1];
      if (
        last.role === 'user' &&
        normalizeTextForDedupe(last.content) === normalizeTextForDedupe(userMessage)
      ) {
        fullHistory.pop();
      }
    }

    // Truncated history sent to OpenAI — last 20 messages keeps token budget sane
    const history = fullHistory;

    const recentAi = await listDocuments('conversations', [
      Query.equal('teamId', resolvedTeamId),
      Query.equal('customerId', customer.$id),
      Query.equal('sentBy', 'ai'),
      Query.orderDesc('$createdAt'),
      Query.limit(1),
    ]);
    const recentAiDoc = recentAi.documents[0] as
      | { message?: string; createdAt?: string; $createdAt?: string }
      | undefined;
    const recentAiText = normalizeTextForDedupe(recentAiDoc?.message || '');
    const recentAiTs = new Date(recentAiDoc?.createdAt || recentAiDoc?.$createdAt || 0).getTime();

    const businessConfigResult = await listDocuments('business_configs', [
      Query.equal('teamId', resolvedTeamId),
      Query.limit(1),
    ]);
    const businessConfig = businessConfigResult.documents[0] as
      | { businessName?: string; openaiSystemPrompt?: string }
      | undefined;
    if (isGreetingMessage(correctedText)) {
      const greetingText = `${getGreetingIntroText(customer.name || null)}\n\n${getGreetingMenuText(customer.name || null)}`;
      const priorGreeting = normalizeTextForDedupe(greetingText);
      if (
        recentAiText === priorGreeting &&
        Number.isFinite(recentAiTs) &&
        Date.now() - recentAiTs <= RECENT_AI_DUPLICATE_WINDOW_MS
      ) {
        console.log('[WhatsApp] Skipping duplicate greeting auto-reply');
        return;
      }

      const greetingSendResult = await sendYCloudGreetingExperience({
        phone,
        requestUrl,
        customerName: customer.name || null,
      }).catch(() => null);

      if (!greetingSendResult) {
        const fallbackText = greetingText;
        const fallbackResult = await sendAutoReply({ phone, message: fallbackText }).catch(() => ({
          success: false,
          messageId: null,
          mode: 'unknown',
        }));

        await createDocument('conversations', {
          teamId: resolvedTeamId,
          customerId: customer.$id,
          phone: phone,
          role: 'assistant',
          message: fallbackText,
          messageType: 'text',
          sentBy: 'ai',
          metaMessageId: (fallbackResult as { messageId?: string | null }).messageId || null,
          deliveryStatus: fallbackResult.success ? 'sent' : 'failed',
          createdAt: new Date().toISOString(),
        });

        await saveLead({
          teamId: resolvedTeamId,
          phone,
          customer,
          intent: 'greeting',
          status: existingLead?.$id ? coerceLeadStatus(existingLead.status) : 'new_lead',
          notes: existingLead?.notes || 'WhatsApp greeting received',
        }).catch(() => {});
        return;
      }

      await createDocument('conversations', {
        teamId: resolvedTeamId,
        customerId: customer.$id,
        phone: phone,
        role: 'assistant',
        message: greetingSendResult.messageText,
        messageType: greetingSendResult.usedInteractiveButtons ? 'interactive' : 'text',
        sentBy: 'ai',
        metaMessageId: greetingSendResult.messageId || null,
        deliveryStatus: greetingSendResult.messageId ? 'sent' : 'failed',
        createdAt: new Date().toISOString(),
      });
      console.log(
        `[OK] Greeting sent to ${phone} via ycloud${
          greetingSendResult.usedInteractiveButtons
            ? greetingSendResult.usedHeaderImage
              ? ' (single interactive card with image)'
              : ' (single interactive card without image)'
            : ' (fallback text)'
        }`
      );
      await saveLead({
        teamId: resolvedTeamId,
        phone,
        customer,
        intent: 'greeting',
        status: existingLead?.$id ? coerceLeadStatus(existingLead.status) : 'new_lead',
        notes: existingLead?.notes || 'WhatsApp greeting received',
      }).catch(() => {});
      return;
    }

    // Resolve structured workflow state using the FULL history (all 40 messages)
    // so the intent lock and slot values are never lost in long conversations.
    const historyUserMessages = fullHistory.filter(h => h.role === 'user').map(h => h.content);
    const rawAiSlotHints = process.env.OPENAI_API_KEY
      ? await withTimeout(
          extractWorkflowSlots(correctedText, intent).catch(() => ({})),
          CLASSIFY_TIMEOUT_MS,
          {}
        )
      : {};
    // Strip lead fields from AI hints — AI must never hallucinate name/phone/email/callback_time
    // from action phrases like "Arrange Callback", which would skip the collect_lead stage.
    // Only travel/service slots are safe to accept from AI extraction.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { name: _n, phone: _p, email: _e, callback_time: _ct, ...aiSlotHints } =
      rawAiSlotHints as Record<string, string>;

    const workflowState = resolveWorkflowState({
      userMessage: correctedText,
      classifiedIntent: intent,
      aiSlots: aiSlotHints,
      historyMessages: historyUserMessages,
    });
    const previousUserMessages = [...historyUserMessages];
    const previousCurrentMessage = previousUserMessages.pop();
    const previousWorkflowState = previousCurrentMessage
      ? resolveWorkflowState({
          userMessage: previousCurrentMessage,
          classifiedIntent: intent,
          historyMessages: previousUserMessages,
        })
      : null;

    const enrichedCustomerName = workflowState.slots.name || customer.name || undefined;
    const enrichedCustomerEmail = workflowState.slots.email || customer.email || undefined;
    const updatedCustomer = await upsertCustomerProfile({
      customerId: customer.$id,
      currentName: customer.name,
      currentEmail: customer.email,
      nextName: enrichedCustomerName,
      nextEmail: enrichedCustomerEmail,
    });
    if (updatedCustomer) {
      customer = {
        ...customer,
        name: enrichedCustomerName,
        email: enrichedCustomerEmail,
      };
    }

    const leadStatus = deriveLeadStatus({
      existingStatus: existingLead?.status,
      isFirstLead: !existingLead?.$id,
      workflowIntent: workflowState.intent,
      workflowStage: workflowState.stage,
      workflowSlots: workflowState.slots,
      userMessage: correctedText,
    });
    const leadNotes =
      workflowState.stage === 'confirmed' && workflowState.slots
        ? buildLeadNotes(workflowState.intent, workflowState.slots)
        : correctedText.slice(0, 300);
    await saveLead({
      teamId: resolvedTeamId,
      phone,
      customer: {
        ...customer,
        name: enrichedCustomerName,
        email: enrichedCustomerEmail,
      },
      intent: workflowState.intent,
      notes: leadNotes,
      status: leadStatus,
    }).catch(() => {});

    if (isHardOffTopicInput(correctedText, workflowState.intent)) {
      const offTopicReply = normalizeToWhatsAppMarkdown(buildOffTopicReply(customer.name || null));
      const sendResult = await sendAutoReply({
        phone,
        message: offTopicReply,
      });
      await createDocument('conversations', {
        teamId: resolvedTeamId,
        customerId: customer.$id,
        phone,
        role: 'assistant',
        message: offTopicReply,
        messageType: 'text',
        sentBy: 'ai',
        metaMessageId: sendResult.messageId || null,
        deliveryStatus: sendResult.success ? 'sent' : 'failed',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    // Deterministic-first: for structured stages (ask_destination, ask_holiday_type,
    // ask_travel_details, collect_lead, ask_callback) send the reply directly without AI.
    // AI is only used for creative stages (show_packages, confirmed, unknown) where
    // buildWorkflowReply returns null. This prevents AI from being anchored to bad
    // patterns in conversation history and ignoring the system prompt task.
    const deterministicReply =
      workflowState.stage === 'confirmed'
        ? buildConfirmedWorkflowReply({
            state: workflowState,
            userMessage: correctedText,
            lastAssistantMessage: recentAiDoc?.message || null,
          })
        : isQuestionLike(correctedText)
          ? null
          : buildWorkflowReply(workflowState);

    if (deterministicReply !== null) {
      const waReply = normalizeToWhatsAppMarkdown(deterministicReply);
      const sendResult = await sendAutoReply({
        phone,
        message: waReply,
      });
      await createDocument('conversations', {
        teamId: resolvedTeamId, customerId: customer.$id, phone,
        role: 'assistant', message: waReply, messageType: 'text',
        sentBy: 'ai', metaMessageId: sendResult.messageId || null,
        deliveryStatus: sendResult.success ? 'sent' : 'failed',
        createdAt: new Date().toISOString(),
      });
      if (sendResult.success) {
        console.log(`[OK] Deterministic reply sent to ${phone} (stage=${workflowState.stage})`);
      }
      return;
    }

    const stageDraftReply = null; // AI stages only (show_packages, confirmed, unknown)

    // Call AI with workflow-aware system prompt
    const knowledgeQuery = [
      correctedText,
      workflowState.intent,
      workflowState.slots.destination,
      workflowState.slots.from_city,
      workflowState.slots.to_city,
      workflowState.slots.travel_time,
      workflowState.slots.nights,
      workflowState.slots.hotel_preference,
    ]
      .filter(Boolean)
      .join(' ');
    const knowledge = await loadTravelKnowledgeFast(resolvedTeamId, knowledgeQuery || correctedText);
    const safeWebsiteSnippets = sanitizeWebsiteSnippetsForBot(knowledge.websiteSnippets);
    const safeBestWebsiteUrl = sanitizeWebsiteUrlForBot(
      knowledge.bestWebsiteUrl || WEBSITE_FALLBACK_URL
    );
    const enforceDatabaseFirst = shouldEnforceDatabaseFirst({
      workflowIntent: workflowState.intent,
      workflowStage: workflowState.stage,
      userMessage: correctedText,
    });
    const customerProfileBlock = [
      `CUSTOMER PROFILE:`,
      `- Name: ${customer.name || 'Unknown'}`,
      `- Phone: ${phone}`,
      `- Team: ${resolvedTeamId}`,
      `Always keep replies personalized and context-aware for this customer.`,
    ].join('\n');
    const databasePolicyBlock = enforceDatabaseFirst
      ? knowledge.databaseSnippets.length > 0
        ? `DATABASE-FIRST POLICY (STRICT):
- Use Appwrite package/flight/hotel data as the PRIMARY truth source.
- Do not invent package names, inclusions, durations, or prices when DB data is available.
- If the user asks for options, extract and present options from the provided PACKAGE KNOWLEDGE.
- If some detail is missing in DB, say it clearly and ask one follow-up question.`
        : `DATABASE-FIRST POLICY:
- No matching package data found in Appwrite for this query.
- You may provide curated sample options, but label them as "sample/estimated".
- Keep pricing realistic in INR and avoid claiming confirmed live inventory.
- Ask the user if they want a human expert callback for exact live inventory.`
      : '';

    const workflowBlock = getWorkflowSystemPromptBlock(
      workflowState.intent,
      workflowState.stage,
      workflowState.slots,
      stageDraftReply
    );
    const memoryBlock = buildConversationMemoryBlock({
      state: workflowState,
      recentMessages: fullHistory,
      recentUserMessages: historyUserMessages.slice(-12),
    });

    const systemPrompt = [
      businessConfig?.openaiSystemPrompt || '',
      `You are Sini, a warm and knowledgeable travel sales assistant for Traventions (a full-service travel agency in India).
You ALWAYS respond — no matter what the customer sends (short, long, confusing, off-topic, emoji-only, Hindi, Hinglish, random text).`,
      getBotRoutePolicyPromptBlock(),
      workflowBlock,
      memoryBlock,
      customerProfileBlock,
      databasePolicyBlock,
      `HANDLING UNEXPECTED INPUTS (mandatory):
- Emoji-only or very short messages (ok, yes, no, 👍, 🙏) → interpret in context of current stage; if ambiguous, re-ask the stage question warmly.
- Questions mid-flow (Is Dubai visa-free? What currency does Bali use?) → briefly answer in 1-2 sentences, then re-ask the stage question.
- Hindi or Hinglish → respond in the same language if possible, continue the flow.
- Angry or frustrated customer → empathize first ("I completely understand your concern 😊"), then offer to help.
- "Speak to human" / "agent" / "staff" → "Sure! Our team can be reached at info@traventions.com. I can also continue helping you right now 😊"
- Completely off-topic (weather, sports, jokes, coding, etc.) → politely refuse and steer back to travel only.
- Random characters or test messages → "Hello! 😊 I'm Sini from Traventions. How can I help you plan your next trip?"
- User wants to change their mind (different destination, different dates) → accept gracefully and update the plan.

GLOBAL RULES:
- WhatsApp formatting only: *bold*, _italic_, numbered lists, bullet * lists. NEVER markdown links [text](url) — plain URLs only.
- INR only for all pricing — never USD or $.
- Keep reply concise and focused. Under 250 words unless generating packages.
- Never repeat questions already answered by the customer.
- ALWAYS send a reply — never respond with empty text.
- Website: ${safeBestWebsiteUrl}`,
      `TONE AND CONTINUITY RULES:
- Reply like a real travel consultant on WhatsApp, not like a scripted bot.
- Never say "as an AI", "I am a bot", "travel assistant bot", or anything mechanical.
- If the customer sends a follow-up like "cheapest", "best", "luxury", "family option", "customise this", or "arrange callback", continue from the existing chat context instead of restarting the flow.
- Prefer natural sentences over rigid forms or checklists.
- Ask only one compact follow-up when something is missing.
- If the needed context is already present in chat history, answer directly instead of showing the menu again.`,
      knowledge.databaseSnippets.length
        ? `\nPACKAGE KNOWLEDGE:\n${knowledge.databaseSnippets.slice(0, 6).map((v, i) => `${i + 1}. ${v}`).join('\n')}`
        : '',
      safeWebsiteSnippets.length
        ? `\nWEBSITE PAGES:\n${safeWebsiteSnippets.slice(0, 4).map((v, i) => `${i + 1}. ${v}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')
      .trim();

    let response: string;
    if (process.env.OPENAI_API_KEY) {
      try {
        response = await getChatResponse(correctedText, systemPrompt, history);
        response = enforceSafeUrlsInReply(response);
      } catch (err) {
        console.error('[WhatsApp] OpenAI reply failed:', err);
        response = stageDraftReply || 'Welcome to Traventions! Thanks for your message. Our team will get back to you shortly.';
      }
    } else {
      response = stageDraftReply || 'Welcome to Traventions! Thanks for your message. Our team will get back to you shortly.';
    }

    const shouldSendCallbackEmail =
      workflowState.stage === 'confirmed' &&
      Boolean(workflowState.slots.callback_time && enrichedCustomerEmail) &&
      previousWorkflowState?.stage !== 'confirmed' &&
      !isConversionIntent(correctedText);

    if (shouldSendCallbackEmail) {
      await sendCallbackEmails({
        customerEmail: enrichedCustomerEmail,
        customerName: enrichedCustomerName,
        phone,
        callbackTime: workflowState.slots.callback_time || '',
        businessName: businessConfig?.businessName,
        serviceSummary: buildServiceSummary(workflowState.intent, leadNotes),
      }).catch((error) => {
        console.warn('[WhatsApp] Callback email skipped:', error instanceof Error ? error.message : error);
      });
    }

    const waFormattedResponse = normalizeToWhatsAppMarkdown(enforceSafeUrlsInReply(response));
    // Never silence the bot on a real user turn. We still keep inbound dedupe guards
    // earlier in the pipeline, so sending a repeated AI message here is safer than
    // dropping the reply entirely.
    if (
      recentAiText === normalizeTextForDedupe(waFormattedResponse) &&
      Number.isFinite(recentAiTs) &&
      Date.now() - recentAiTs <= RECENT_AI_DUPLICATE_WINDOW_MS
    ) {
      console.log('[WhatsApp] AI response text matches recent reply; sending anyway to avoid silent turns');
    }

    const sendResult = await sendAutoReply({
      phone,
      message: waFormattedResponse,
    });

    // Save the outgoing message with the actual provider message ID
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
        console.log(`[OK] AI response sent to ${phone} via ${sendResult.mode}`);
      } else {
        console.error('Failed to send AI response');
      }
    } finally {
      await typingKeepAlive.stop();
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
