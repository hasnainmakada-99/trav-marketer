interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  raw?: unknown;
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
