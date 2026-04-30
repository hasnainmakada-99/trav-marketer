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
}

export function parseWhatsAppWebhook(body: WebhookPayload) {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    return {
      phoneNumberId: value?.metadata?.phone_number_id,
      displayPhoneNumber: value?.metadata?.display_phone_number,
      contact: value?.contacts?.[0],
      messages: value?.messages || [],
      statuses: value?.statuses || [],
    };
  } catch (error) {
    console.error('Error parsing WhatsApp webhook:', error);
    return null;
  }
}

export function extractMessage(message: IncomingMessage) {
  if (!message) return null;

  const base = {
    phone: message.from,
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
    phone: status.recipient_id,
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
