/**
 * WhatsApp API Helper Functions
 * 
 * Utilities for sending and receiving WhatsApp messages via Meta Cloud API
 */

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
  parameters?: Record<string, any>;
  whatsappToken: string;
}

/**
 * Send a text message via WhatsApp
 */
export async function sendWhatsAppMessage({
  phoneNumberId,
  recipientPhone,
  message,
  whatsappToken,
}: SendWhatsAppMessageParams) {
  try {
    const response = await fetch(
      `https://graph.instagram.com/v18.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipientPhone,
          type: 'text',
          text: {
            preview_url: true,
            body: message,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`WhatsApp API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    throw error;
  }
}

/**
 * Send a pre-approved WhatsApp template message
 */
export async function sendWhatsAppTemplate({
  phoneNumberId,
  recipientPhone,
  templateName,
  templateLanguage = 'en',
  parameters = {},
  whatsappToken,
}: SendWhatsAppTemplateParams) {
  try {
    const response = await fetch(
      `https://graph.instagram.com/v18.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipientPhone,
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: templateLanguage,
            },
            components: [
              {
                type: 'body',
                parameters: Object.values(parameters).map(value => ({
                  type: 'text',
                  text: String(value),
                })),
              },
            ],
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`WhatsApp API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error sending WhatsApp template:', error);
    throw error;
  }
}

/**
 * Verify WhatsApp webhook token
 * Used when setting up the webhook endpoint
 */
export function verifyWebhookToken(
  token: string,
  verifyToken: string
): boolean {
  return token === verifyToken;
}

/**
 * Parse incoming WhatsApp webhook payload
 */
export function parseWhatsAppWebhook(body: any) {
  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    return {
      waBusinessAccountId: value?.metadata?.phone_number_id,
      phoneNumberId: value?.metadata?.phone_number_id,
      messages: value?.messages || [],
      statuses: value?.statuses || [],
      metadata: value?.metadata,
    };
  } catch (error) {
    console.error('Error parsing WhatsApp webhook:', error);
    return null;
  }
}

/**
 * Extract message from WhatsApp webhook payload
 */
export function extractMessage(message: any) {
  if (!message) return null;

  const phone = message.from;
  const timestamp = message.timestamp;

  if (message.type === 'text') {
    return {
      phone,
      timestamp,
      type: 'text',
      text: message.text?.body || '',
      messageId: message.id,
    };
  }

  if (message.type === 'image') {
    return {
      phone,
      timestamp,
      type: 'image',
      imageId: message.image?.id,
      messageId: message.id,
    };
  }

  if (message.type === 'document') {
    return {
      phone,
      timestamp,
      type: 'document',
      documentId: message.document?.id,
      fileName: message.document?.filename,
      messageId: message.id,
    };
  }

  if (message.type === 'interactive') {
    return {
      phone,
      timestamp,
      type: 'interactive',
      interactionType: message.interactive?.type,
      messageId: message.id,
    };
  }

  return null;
}

/**
 * Extract delivery status from WhatsApp webhook
 */
export function extractStatus(status: any) {
  if (!status) return null;

  return {
    phone: status.recipient_id,
    messageId: status.id,
    status: status.status, // sent / delivered / read / failed
    timestamp: status.timestamp,
    errors: status.errors,
  };
}

/**
 * Mark message as read (send read receipt)
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
  try {
    const response = await fetch(
      `https://graph.instagram.com/v18.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      }
    );

    return await response.json();
  } catch (error) {
    console.error('Error marking message as read:', error);
    throw error;
  }
}
