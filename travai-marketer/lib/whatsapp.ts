/**
 * WhatsApp Cloud API Helper Functions (Meta Graph API v21.0)
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  raw?: unknown;
}

interface SendWhatsAppMessageParams {
  phoneNumberId: string;
  recipientPhone: string;
  message: string;
  whatsappToken: string;
}

interface SendWhatsAppTemplateParams {
  phoneNumberId: string;
  recipientPhone: string;
  templateName: string;
  templateLanguage?: string;
  parameters?: Array<string | number>;
  whatsappToken: string;
}

export interface WhatsAppTemplate {
  id?: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: Array<{
    type: string;
    text?: string;
    format?: string;
    example?: unknown;
  }>;
}

function normalizePhone(phone: string): string {
  // Strip everything except digits. Meta API expects E.164 without "+".
  return phone.replace(/[^\d]/g, '');
}

/**
 * Send a free-form text message via WhatsApp.
 * Note: only works inside a 24-hour customer-initiated session window.
 */
export async function sendWhatsAppMessage({
  phoneNumberId,
  recipientPhone,
  message,
  whatsappToken,
}: SendWhatsAppMessageParams): Promise<SendResult> {
  try {
    const response = await fetch(
      `${GRAPH_API_BASE}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizePhone(recipientPhone),
          type: 'text',
          text: {
            preview_url: true,
            body: message,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data?.error?.message || `WhatsApp API error: ${response.status}`,
        raw: data,
      };
    }

    return {
      success: true,
      messageId: data?.messages?.[0]?.id,
      raw: data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send an approved WhatsApp template message (works outside the 24-hour window).
 */
export async function sendWhatsAppTemplate({
  phoneNumberId,
  recipientPhone,
  templateName,
  templateLanguage = 'en_US',
  parameters = [],
  whatsappToken,
}: SendWhatsAppTemplateParams): Promise<SendResult> {
  try {
    const components =
      parameters.length > 0
        ? [
            {
              type: 'body',
              parameters: parameters.map((value) => ({
                type: 'text',
                text: String(value),
              })),
            },
          ]
        : undefined;

    const response = await fetch(
      `${GRAPH_API_BASE}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: normalizePhone(recipientPhone),
          type: 'template',
          template: {
            name: templateName,
            language: { code: templateLanguage },
            ...(components ? { components } : {}),
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data?.error?.message || `WhatsApp API error: ${response.status}`,
        raw: data,
      };
    }

    return {
      success: true,
      messageId: data?.messages?.[0]?.id,
      raw: data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Fetch all message templates from a WhatsApp Business Account.
 */
export async function listWhatsAppTemplates({
  whatsappBusinessAccountId,
  whatsappToken,
}: {
  whatsappBusinessAccountId: string;
  whatsappToken: string;
}): Promise<WhatsAppTemplate[]> {
  const response = await fetch(
    `${GRAPH_API_BASE}/${whatsappBusinessAccountId}/message_templates?limit=200`,
    {
      headers: {
        Authorization: `Bearer ${whatsappToken}`,
      },
      cache: 'no-store',
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `Failed to list templates: ${response.status}`
    );
  }

  return (data?.data ?? []) as WhatsAppTemplate[];
}

/**
 * Verify WhatsApp webhook token (used by GET /api/whatsapp/webhook).
 */
export function verifyWebhookToken(
  token: string,
  verifyToken: string
): boolean {
  return token === verifyToken;
}

/**
 * Parse incoming WhatsApp webhook payload.
 */
interface IncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  document?: { id?: string; filename?: string; mime_type?: string };
  audio?: { id?: string };
  video?: { id?: string };
  interactive?: { type?: string };
}

interface IncomingStatus {
  id: string;
  recipient_id: string;
  status: string;
  timestamp: string;
  errors?: unknown[];
}

interface WebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: IncomingMessage[];
        statuses?: IncomingStatus[];
      };
    }>;
  }>;
  type?: string;
  createTime?: string;
  whatsappInboundMessage?: {
    id?: string;
    wamid?: string;
    from?: string;
    to?: string;
    type?: string;
    text?: { body?: string };
    image?: { id?: string; mime_type?: string; caption?: string };
    document?: { id?: string; filename?: string; mime_type?: string };
    audio?: { id?: string };
    video?: { id?: string };
    interactive?: { type?: string };
    createTime?: string;
    sendTime?: string;
  };
  whatsappMessage?: {
    id?: string;
    from?: string;
    to?: string;
    type?: string;
    status?: string;
    text?: { body?: string };
    updateTime?: string;
    createTime?: string;
  };
  data?: {
    whatsappInboundMessage?: WebhookPayload['whatsappInboundMessage'];
    whatsappMessage?: WebhookPayload['whatsappMessage'];
  };
}

function toUnixSeconds(value?: string): string {
  if (!value) return `${Math.floor(Date.now() / 1000)}`;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return `${Math.floor(Date.now() / 1000)}`;
  return `${Math.floor(ts / 1000)}`;
}

function inferYCloudMessageType(message: Record<string, unknown>): string {
  if (typeof message.type === 'string' && message.type.trim()) {
    return message.type;
  }
  if (message.text) return 'text';
  if (message.image) return 'image';
  if (message.document) return 'document';
  if (message.audio) return 'audio';
  if (message.video) return 'video';
  return 'text';
}

export function parseWhatsAppWebhook(body: WebhookPayload) {
  try {
    // Meta Cloud API webhook shape
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    if (value) {
      return {
        phoneNumberId: value?.metadata?.phone_number_id,
        displayPhoneNumber: value?.metadata?.display_phone_number,
        contact: value?.contacts?.[0],
        messages: value?.messages || [],
        statuses: value?.statuses || [],
      };
    }

    // YCloud webhook shape
    const inbound = body.whatsappInboundMessage || body.data?.whatsappInboundMessage;
    const ycloudMessage = body.whatsappMessage || body.data?.whatsappMessage;
    const eventType = String(body.type || '');

    const messages: IncomingMessage[] = [];
    const statuses: IncomingStatus[] = [];

    if (inbound) {
      const inferredType = inferYCloudMessageType(inbound as Record<string, unknown>);
      messages.push({
        from: String(inbound.from || ''),
        id: String(inbound.wamid || inbound.id || ''),
        timestamp: toUnixSeconds(inbound.sendTime || inbound.createTime || body.createTime),
        type: inferredType,
        text: inbound.text,
        image: inbound.image,
        document: inbound.document,
        audio: inbound.audio,
        video: inbound.video,
        interactive: inbound.interactive,
      });
    } else if (eventType.includes('inbound') && ycloudMessage) {
      const inferredType = inferYCloudMessageType(ycloudMessage as Record<string, unknown>);
      messages.push({
        from: String(ycloudMessage.from || ''),
        id: String(ycloudMessage.id || ''),
        timestamp: toUnixSeconds(ycloudMessage.createTime || body.createTime),
        type: inferredType,
        text: ycloudMessage.text,
      });
    }

    if (ycloudMessage?.status) {
      statuses.push({
        id: String(ycloudMessage.id || ''),
        recipient_id: String(ycloudMessage.to || ''),
        status: String(ycloudMessage.status || ''),
        timestamp: toUnixSeconds(ycloudMessage.updateTime || body.createTime),
      });
    }

    return {
      phoneNumberId: '',
      displayPhoneNumber: '',
      contact: undefined,
      messages,
      statuses,
    };
  } catch (error) {
    console.error('Error parsing WhatsApp webhook:', error);
    return null;
  }
}

export function extractMessage(message: IncomingMessage) {
  if (!message) return null;

  const base = {
    phone: normalizePhone(message.from || ''),
    timestamp: message.timestamp,
    messageId: message.id,
    type: message.type,
  };

  if (message.type === 'text') {
    return { ...base, text: message.text?.body || '' };
  }

  if (message.type === 'image') {
    return {
      ...base,
      mediaId: message.image?.id,
      caption: message.image?.caption,
      mimeType: message.image?.mime_type,
    };
  }

  if (message.type === 'document') {
    return {
      ...base,
      mediaId: message.document?.id,
      fileName: message.document?.filename,
      mimeType: message.document?.mime_type,
    };
  }

  if (message.type === 'audio' || message.type === 'video') {
    return {
      ...base,
      mediaId:
        message.type === 'audio' ? message.audio?.id : message.video?.id,
    };
  }

  return base;
}

export function extractStatus(status: IncomingStatus) {
  if (!status) return null;
  return {
    phone: normalizePhone(status.recipient_id || ''),
    messageId: status.id,
    status: status.status,
    timestamp: status.timestamp,
    errors: status.errors,
  };
}

/**
 * Mark message as read (sends a read receipt to the customer).
 */
export async function markMessageAsRead({
  phoneNumberId,
  messageId,
  whatsappToken,
}: {
  phoneNumberId: string;
  messageId: string;
  whatsappToken: string;
}) {
  const response = await fetch(
    `${GRAPH_API_BASE}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${whatsappToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    }
  );

  return response.json();
}

/**
 * Get WhatsApp Business profile info (display name, about, etc.).
 */
export async function getWhatsAppProfile({
  phoneNumberId,
  whatsappToken,
}: {
  phoneNumberId: string;
  whatsappToken: string;
}) {
  const response = await fetch(
    `${GRAPH_API_BASE}/${phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
    {
      headers: { Authorization: `Bearer ${whatsappToken}` },
      cache: 'no-store',
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Failed to fetch profile');
  }
  return data?.data?.[0] || null;
}
