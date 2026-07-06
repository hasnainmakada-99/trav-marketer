interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  raw?: unknown;
}

interface SimpleResult {
  success: boolean;
  error?: string;
  raw?: unknown;
}

interface ButtonOption {
  id: string;
  title: string;
}

function toE164(phone: string): string {
  const trimmed = String(phone || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return `+${trimmed.replace(/[^\d]/g, '')}`;
  return `+${trimmed.replace(/[^\d]/g, '')}`;
}

export async function sendYCloudTextMessage(params: {
  apiKey: string;
  fromPhoneE164: string;
  toPhone: string;
  message: string;
}): Promise<SendResult> {
  try {
    const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages/sendDirectly', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': params.apiKey,
      },
      body: JSON.stringify({
        from: toE164(params.fromPhoneE164),
        to: toE164(params.toPhone),
        type: 'text',
        text: {
          body: params.message,
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        error:
          data?.error?.message ||
          data?.error?.whatsappApiError?.message ||
          `YCloud API error: ${response.status}`,
        raw: data,
      };
    }

    return {
      success: true,
      messageId: data?.whatsappMessage?.id || data?.id || data?.messageId || null,
      raw: data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function sendYCloudImageMessage(params: {
  apiKey: string;
  fromPhoneE164: string;
  toPhone: string;
  imageUrl: string;
  caption?: string;
}): Promise<SendResult> {
  try {
    const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages/sendDirectly', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': params.apiKey,
      },
      body: JSON.stringify({
        from: toE164(params.fromPhoneE164),
        to: toE164(params.toPhone),
        type: 'image',
        image: {
          link: String(params.imageUrl || '').trim(),
          ...(params.caption?.trim() ? { caption: params.caption.trim() } : {}),
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        error:
          data?.error?.message ||
          data?.error?.whatsappApiError?.message ||
          `YCloud API error: ${response.status}`,
        raw: data,
      };
    }

    return {
      success: true,
      messageId: data?.whatsappMessage?.id || data?.id || data?.messageId || null,
      raw: data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function sendYCloudReplyButtonsMessage(params: {
  apiKey: string;
  fromPhoneE164: string;
  toPhone: string;
  bodyText: string;
  buttons: ButtonOption[];
  headerImageUrl?: string;
}): Promise<SendResult> {
  try {
    const cleanedButtons = params.buttons
      .map((b) => ({
        id: String(b.id || '').trim(),
        title: String(b.title || '').trim().slice(0, 20),
      }))
      .filter((b) => b.id && b.title)
      .slice(0, 3);

    if (cleanedButtons.length === 0) {
      return { success: false, error: 'At least one button is required' };
    }

    const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages/sendDirectly', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': params.apiKey,
      },
      body: JSON.stringify({
        from: toE164(params.fromPhoneE164),
        to: toE164(params.toPhone),
        type: 'interactive',
        interactive: {
          type: 'button',
          ...(params.headerImageUrl?.trim()
            ? {
                header: {
                  type: 'image',
                  image: {
                    link: params.headerImageUrl.trim(),
                  },
                },
              }
            : {}),
          body: {
            text: params.bodyText,
          },
          action: {
            buttons: cleanedButtons.map((btn) => ({
              type: 'reply',
              reply: {
                id: btn.id,
                title: btn.title,
              },
            })),
          },
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        error:
          data?.error?.message ||
          data?.error?.whatsappApiError?.message ||
          `YCloud API error: ${response.status}`,
        raw: data,
      };
    }

    return {
      success: true,
      messageId: data?.whatsappMessage?.id || data?.id || data?.messageId || null,
      raw: data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function sendYCloudDocumentMessage(params: {
  apiKey: string;
  fromPhoneE164: string;
  toPhone: string;
  documentUrl: string;
  fileName?: string;
  caption?: string;
}): Promise<SendResult> {
  try {
    const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages/sendDirectly', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': params.apiKey,
      },
      body: JSON.stringify({
        from: toE164(params.fromPhoneE164),
        to: toE164(params.toPhone),
        type: 'document',
        document: {
          link: String(params.documentUrl || '').trim(),
          ...(params.fileName?.trim() ? { fileName: params.fileName.trim() } : {}),
          ...(params.caption?.trim() ? { caption: params.caption.trim() } : {}),
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        error:
          data?.error?.message ||
          data?.error?.whatsappApiError?.message ||
          `YCloud API error: ${response.status}`,
        raw: data,
      };
    }

    return {
      success: true,
      messageId: data?.whatsappMessage?.id || data?.id || data?.messageId || null,
      raw: data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function showYCloudTypingIndicator(params: {
  apiKey: string;
  inboundMessageId: string;
}): Promise<SimpleResult> {
  const inboundId = String(params.inboundMessageId || '').trim();
  if (!inboundId) {
    return { success: false, error: 'Missing inbound message id' };
  }

  try {
    const response = await fetch(
      `https://api.ycloud.com/v2/whatsapp/inboundMessages/${encodeURIComponent(inboundId)}/typingIndicator`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': params.apiKey,
        },
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        error:
          data?.error?.message ||
          data?.error?.whatsappApiError?.message ||
          `YCloud typing indicator error: ${response.status}`,
        raw: data,
      };
    }

    return { success: true, raw: data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
