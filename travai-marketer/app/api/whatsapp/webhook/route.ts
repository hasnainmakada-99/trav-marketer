import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import {
  extractMessage,
  extractStatus,
  parseWhatsAppWebhook,
  sendWhatsAppMessage,
  verifyWebhookToken,
} from '@/lib/whatsapp';
import {
  sendYCloudTextMessage,
  sendYCloudReplyButtonsMessage,
  showYCloudTypingIndicator,
} from '@/lib/whatsapp-ycloud';
import { getChatResponse, classifyIntent, extractCustomerInfo } from '@/lib/openai';
import { createDocument, listDocuments, updateDocument } from '@/lib/appwrite';
import { normalizeToWhatsAppMarkdown } from '@/lib/whatsapp-format';
import { createHmac, timingSafeEqual } from 'crypto';
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
  buildWorkflowReply,
  detectWorkflowIntent,
  getGreetingMenuText,
  getWorkflowSystemPromptBlock,
  PRIMARY_QUICK_MENU_OPTIONS,
  resolveWorkflowState,
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
const GREETING_MENU_TEXT = getGreetingMenuText();

function isGreetingMessage(text: string) {
  const normalized = text.trim().toLowerCase();
  return /^(hi|hello|hey|hlo|helo|namaste|yo|good morning|good afternoon|good evening)$/.test(
    normalized
  );
}

function detectServiceSelection(text: string) {
  const detected = detectWorkflowIntent(text);
  return detected === 'unknown' ? null : detected;
}

function looksLikeWorkflowDataMessage(text: string) {
  return /(from|to|destination|travel|date|travellers|travelers|passengers|adults|nights|budget|check-?in|check-?out|callback|\+?\d[\d -]{7,})/i.test(
    text
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

function resolveOutboundMode() {
  const forced = (process.env.WHATSAPP_OUTBOUND_MODE || '').trim().toLowerCase();
  if (forced === 'bridge' || forced === 'meta' || forced === 'ycloud') {
    return forced;
  }
  if ((process.env.YCLOUD_API_KEY || '').trim()) {
    return 'ycloud';
  }
  return process.env.BRIDGE_SHARED_SECRET ? 'bridge' : 'meta';
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
  if (resolveOutboundMode() === 'ycloud') {
    return false;
  }
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
  const result = await sendYCloudTextMessage({
    apiKey,
    fromPhoneE164: fromPhone,
    toPhone: params.phone,
    message: params.message,
  });
  if (!result.success) {
    throw new Error(result.error || 'YCloud send failed');
  }
  return {
    success: true,
    mode: 'ycloud',
    messageId: result.messageId || null,
  };
}

async function sendYCloudGreetingExperience(params: {
  phone: string;
  requestUrl: string;
}) {
  const apiKey = (process.env.YCLOUD_API_KEY || '').trim();
  const fromPhone = (process.env.YCLOUD_WHATSAPP_FROM || '').trim();
  if (!apiKey || !fromPhone) {
    throw new Error('YCloud send is not configured. Set YCLOUD_API_KEY and YCLOUD_WHATSAPP_FROM.');
  }

  const imageUrl = getGreetingImageUrl(params.requestUrl);
  const menuResult = await sendYCloudReplyButtonsMessage({
    apiKey,
    fromPhoneE164: fromPhone,
    toPhone: params.phone,
    bodyText: GREETING_MENU_TEXT,
    buttons: [...GREETING_BUTTONS],
    headerImageUrl: imageUrl,
  });
  if (!menuResult.success) {
    throw new Error(menuResult.error || 'Failed to send greeting interactive card via YCloud');
  }

  return {
    menuMessageId: menuResult.messageId || null,
  };
}

async function startYCloudTypingKeepAlive(inboundMessageId: string | null) {
  if (resolveOutboundMode() !== 'ycloud' || !inboundMessageId) {
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

async function sendViaMetaCloud(params: {
  phone: string;
  message: string;
  webhookPhoneNumberId: string;
}) {
  const phoneNumberId =
    params.webhookPhoneNumberId || (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const whatsappToken = (process.env.WHATSAPP_TOKEN || '').trim();
  if (!phoneNumberId || !whatsappToken) {
    throw new Error(
      'Meta Cloud send is not configured. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN.'
    );
  }
  const result = await sendWhatsAppMessage({
    phoneNumberId,
    recipientPhone: params.phone,
    message: params.message,
    whatsappToken,
  });
  if (!result.success) {
    throw new Error(result.error || 'Meta Cloud send failed');
  }
  return {
    success: true,
    mode: 'meta',
    messageId: result.messageId || null,
  };
}

async function queueBridgeReply(params: {
  requestUrl: string;
  teamId: string;
  customerId: string;
  phone: string;
  message: string;
}) {
  const controlUrl = new URL('/api/wa-bridge/control', params.requestUrl);
  const controlRes = await fetch(controlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      teamId: params.teamId,
      action: 'send_text',
      payload: {
        phone: params.phone,
        message: params.message,
        customerId: params.customerId,
      },
    }),
  });
  const controlData = await controlRes.json().catch(() => ({}));
  if (!controlRes.ok) {
    throw new Error(controlData?.error || 'Failed to queue bridge reply');
  }
  return {
    success: true,
    mode: 'bridge',
    messageId: controlData?.commandId || null,
  };
}

async function sendAutoReply(params: {
  requestUrl: string;
  teamId: string;
  customerId: string;
  phone: string;
  message: string;
  webhookPhoneNumberId: string;
}) {
  const mode = resolveOutboundMode();
  if (mode === 'ycloud') {
    return sendViaYCloud({ phone: params.phone, message: params.message });
  }
  if (mode === 'meta') {
    return sendViaMetaCloud({
      phone: params.phone,
      message: params.message,
      webhookPhoneNumberId: params.webhookPhoneNumberId,
    });
  }
  return queueBridgeReply(params);
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

    if (messageId) {
      const existing = await listDocuments('conversations', [
        Query.equal('teamId', teamId),
        Query.equal('phone', phone),
        Query.equal('sentBy', 'customer'),
        Query.equal('metaMessageId', messageId),
        Query.limit(1),
      ]);
      if (existing.documents.length > 0) {
        console.log(`[WhatsApp] Skipping duplicate inbound messageId=${messageId}`);
        markInboundProcessed(dedupeKey);
        return;
      }
    }

    console.log(`[Incoming] Incoming ${type} message from ${phone}:`, text || messageId);

    // Find or create customer record
    let customer = await findOrCreateCustomer(phone, teamId);

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
    markInboundProcessed(dedupeKey);

    if (!text) {
      return;
    }

    // Non-critical: extract profile details in background so reply path stays fast.
    if (process.env.OPENAI_API_KEY) {
      extractCustomerInfo(text)
        .then(async (extractedInfo) => {
          if (extractedInfo?.name && !customer.name) {
            customer = await updateDocument('customers', customer.$id, {
              name: extractedInfo.name,
              email: extractedInfo.email,
              phone: extractedInfo.phone || phone,
              updatedAt: new Date().toISOString(),
            });
          }
        })
        .catch(() => {});
    }

    const handover = await hasHumanTakeover(teamId, phone);
    if (handover) {
      console.log(`[WhatsApp] AI suppressed for ${phone} due to staff takeover`);
      return;
    }

    const greetingMessage = isGreetingMessage(text);
    // Classify the intent only when OpenAI key exists, otherwise fall back.
    const businessContext = `Team: ${teamId}, channel: whatsapp`;
    const intent = greetingMessage
      ? 'greeting'
      : process.env.OPENAI_API_KEY
        ? await withTimeout(
            classifyIntent(text, businessContext).catch(() => 'other'),
            CLASSIFY_TIMEOUT_MS,
            'other'
          )
        : 'other';

    // Generate AI response for all non-complaint intents.
    if (intent !== 'complaint') {
      await generateAndSendResponse(
        customer,
        text,
        phone,
        intent,
        webhookPhoneNumberId,
        teamId,
        requestUrl,
        messageId
      );
    } else {
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
  teamId: string,
  requestUrl: string,
  inboundMessageId: string | null
) {
  try {
    const resolvedTeamId =
      teamId || customer.teamId || process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'system';
    const typingKeepAlive = await startYCloudTypingKeepAlive(inboundMessageId);
    try {

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
    // Current inbound was already stored above, so remove it from history to avoid double prompting.
    if (history.length > 0) {
      const last = history[history.length - 1];
      if (
        last.role === 'user' &&
        normalizeTextForDedupe(last.content) === normalizeTextForDedupe(userMessage)
      ) {
        history.pop();
      }
    }
    const assistantMessages = historyRows.filter((row) => row.role === 'assistant').length;
    const firstAssistantReply = assistantMessages === 0;
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
    const workflowIntent = detectWorkflowIntent(userMessage, intent);

    if (isGreetingMessage(userMessage)) {
      const mode = resolveOutboundMode();
      const greetingMenu = getGreetingMenuText(customer.name || null);

      if (mode === 'ycloud') {
        const priorGreeting = normalizeTextForDedupe(greetingMenu);
        if (
          recentAiText === priorGreeting &&
          Number.isFinite(recentAiTs) &&
          Date.now() - recentAiTs <= RECENT_AI_DUPLICATE_WINDOW_MS
        ) {
          console.log('[WhatsApp] Skipping duplicate greeting auto-reply');
          return;
        }

        const greetingSend = await sendYCloudGreetingExperience({
          phone,
          requestUrl,
        });

        await createDocument('conversations', {
          teamId: resolvedTeamId,
          customerId: customer.$id,
          phone: phone,
          role: 'assistant',
          message: greetingMenu,
          messageType: 'interactive',
          sentBy: 'ai',
          metaMessageId: greetingSend.menuMessageId || null,
          deliveryStatus: 'sent',
          createdAt: new Date().toISOString(),
        });
        return;
      }

      const quickMenuReply = normalizeToWhatsAppMarkdown(greetingMenu);
      if (
        recentAiText === normalizeTextForDedupe(quickMenuReply) &&
        Number.isFinite(recentAiTs) &&
        Date.now() - recentAiTs <= RECENT_AI_DUPLICATE_WINDOW_MS
      ) {
        console.log('[WhatsApp] Skipping duplicate greeting auto-reply');
        return;
      }
      const sendResult = await sendAutoReply({
        requestUrl,
        teamId: resolvedTeamId,
        customerId: customer.$id,
        phone,
        message: quickMenuReply,
        webhookPhoneNumberId,
      });

      await createDocument('conversations', {
        teamId: resolvedTeamId,
        customerId: customer.$id,
        phone: phone,
        role: 'assistant',
        message: quickMenuReply,
        messageType: 'text',
        sentBy: 'ai',
        metaMessageId: sendResult.messageId || null,
        deliveryStatus: sendResult.success ? 'sent' : 'failed',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const selectedService = detectServiceSelection(userMessage);
    const historyMessages = historyRows
      .slice(0, 20)
      .reverse()
      .map((row) => String(row.message || ''))
      .filter(Boolean);
    const workflowState = resolveWorkflowState({
      userMessage,
      classifiedIntent: intent,
      selectedIntent: selectedService,
      historyMessages,
    });
    const packageIntent =
      workflowIntent === 'plan_holiday' || isPackageIntent(userMessage, intent);

    const deterministicWorkflowReply = buildWorkflowReply(workflowState);
    const shouldUseDeterministicWorkflow =
      workflowState.intent !== 'unknown' &&
      Boolean(deterministicWorkflowReply) &&
      (selectedService !== null ||
        looksLikeWorkflowDataMessage(userMessage) ||
        !process.env.OPENAI_API_KEY);

    if (shouldUseDeterministicWorkflow && deterministicWorkflowReply) {
      const waWorkflowReply = normalizeToWhatsAppMarkdown(deterministicWorkflowReply);
      if (
        recentAiText === normalizeTextForDedupe(waWorkflowReply) &&
        Number.isFinite(recentAiTs) &&
        Date.now() - recentAiTs <= RECENT_AI_DUPLICATE_WINDOW_MS
      ) {
        console.log('[WhatsApp] Skipping duplicate deterministic workflow response');
        return;
      }

      const sendResult = await sendAutoReply({
        requestUrl,
        teamId: resolvedTeamId,
        customerId: customer.$id,
        phone,
        message: waWorkflowReply,
        webhookPhoneNumberId,
      });

      await createDocument('conversations', {
        teamId: resolvedTeamId,
        customerId: customer.$id,
        phone: phone,
        role: 'assistant',
        message: waWorkflowReply,
        messageType: 'text',
        sentBy: 'ai',
        metaMessageId: sendResult.messageId || null,
        deliveryStatus: sendResult.success ? 'sent' : 'failed',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    let knowledge: Awaited<ReturnType<typeof loadTravelKnowledge>> = {
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
    let safeWebsiteSnippets: string[] = [];
    let routeChoice = resolveSafeRouteChoice({
      message: userMessage,
      classifiedIntent: intent,
      websiteUrlHint: knowledge.bestWebsiteUrl,
    });
    let safeBestWebsiteUrl = sanitizeWebsiteUrlForBot(knowledge.bestWebsiteUrl);
    let systemPrompt = '';

    if (!selectedService && process.env.OPENAI_API_KEY) {
      knowledge = await loadTravelKnowledgeFast(resolvedTeamId, userMessage);
      safeWebsiteSnippets = sanitizeWebsiteSnippetsForBot(knowledge.websiteSnippets);
      routeChoice = resolveSafeRouteChoice({
        message: userMessage,
        classifiedIntent: intent,
        websiteUrlHint: knowledge.bestWebsiteUrl,
      });
      safeBestWebsiteUrl = sanitizeWebsiteUrlForBot(knowledge.bestWebsiteUrl);

      systemPrompt =
        `${businessConfig?.openaiSystemPrompt || ''}\n\n` +
        `You are Traventions' WhatsApp assistant.
Mention Traventions in customer-facing replies.
${firstAssistantReply ? 'Start this reply with "Welcome to Traventions!".' : 'Do not repeat the welcome line on every reply.'}
${getBotRoutePolicyPromptBlock()}
${getWorkflowSystemPromptBlock(workflowIntent)}
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
Best safe website page: ${knowledge.bestWebsiteTitle} (${safeBestWebsiteUrl})
Preferred route for this query: ${routeChoice.url}${routeChoice.loginRequired ? ' (login required)' : ''}
DATABASE KNOWLEDGE:
${knowledge.databaseSnippets.length ? knowledge.databaseSnippets.map((v, i) => `${i + 1}. ${v}`).join('\n') : 'No relevant snippets found.'}
WEBSITE PAGE INDEX:
${safeWebsiteSnippets.length ? safeWebsiteSnippets.map((v, i) => `${i + 1}. ${v}`).join('\n') : `1. Traventions - ${WEBSITE_FALLBACK_URL}`}`.trim();
    }

    let response: string;
    if (process.env.OPENAI_API_KEY) {
      try {
        response = await getChatResponse(
          userMessage,
          systemPrompt || "You are Traventions' WhatsApp assistant.",
          history
        );
        response = enforceSafeUrlsInReply(response);
      } catch (error) {
        console.error('[WhatsApp] OpenAI reply generation failed, using fallback:', error);
        response =
          'Welcome to Traventions! Thanks for your message. Our team will get back to you shortly.';
      }
    } else {
      response = packageIntent
        ? buildRuleBasedItinerary(userMessage)
        : 'Welcome to Traventions! Thanks for your message. Our team will get back to you shortly.';
    }

    const preferredUrl = routeChoice.url || safeBestWebsiteUrl || sanitizeWebsiteUrlForBot(WEBSITE_FALLBACK_URL);
    const responseWithFallback =
      packageIntent && !response.includes(preferredUrl)
        ? `${response}\n\nFor latest packages, please visit ${preferredUrl}.`
        : response;
    const safeResponse = enforceSafeUrlsInReply(responseWithFallback);
    const waFormattedResponse = normalizeToWhatsAppMarkdown(safeResponse);
    if (
      recentAiText === normalizeTextForDedupe(waFormattedResponse) &&
      Number.isFinite(recentAiTs) &&
      Date.now() - recentAiTs <= RECENT_AI_DUPLICATE_WINDOW_MS
    ) {
      console.log('[WhatsApp] Skipping duplicate AI response send');
      return;
    }

    const sendResult = await sendAutoReply({
      requestUrl,
      teamId: resolvedTeamId,
      customerId: customer.$id,
      phone,
      message: waFormattedResponse,
      webhookPhoneNumberId,
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

