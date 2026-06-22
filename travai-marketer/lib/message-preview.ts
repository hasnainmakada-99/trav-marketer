function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function isWhatsAppMessageId(value: string | null | undefined) {
  const text = normalizeWhitespace(String(value || ''));
  return /^wamid\.[A-Za-z0-9+/=_-]{20,}$/i.test(text);
}

export function isAiReplyPlaceholder(value: string | null | undefined) {
  const text = normalizeWhitespace(String(value || ''));
  return /^AI reply sent(?: \([^)]+\))?$/i.test(text);
}

export function humanizeMessagePreview(
  value: string | null | undefined,
  options?: {
    messageType?: string | null;
    direction?: 'incoming' | 'outgoing' | null;
  }
) {
  const text = normalizeWhitespace(String(value || ''));
  const messageType = String(options?.messageType || '').trim().toLowerCase();
  const direction = options?.direction || null;

  if (text && text !== '[unsupported]') {
    if (isWhatsAppMessageId(text)) {
      return direction === 'outgoing' ? 'WhatsApp message sent' : 'WhatsApp message received';
    }
    if (isAiReplyPlaceholder(text)) {
      return 'AI reply sent';
    }
    if (/^Greeting sent$/i.test(text)) {
      return 'Greeting sent';
    }
    return text;
  }

  if (messageType === 'image') return 'Photo attachment';
  if (messageType === 'audio' || messageType === 'voice') return 'Voice note';
  if (messageType === 'video') return 'Video attachment';
  if (messageType === 'document') return 'Document attachment';
  if (messageType && messageType !== 'text') return `${messageType} attachment`;
  return direction === 'outgoing' ? 'Message sent' : 'Message received';
}

export function humanizeLeadNotes(value: string | null | undefined) {
  const text = normalizeWhitespace(String(value || ''));
  if (!text) return null;
  if (isWhatsAppMessageId(text)) return 'WhatsApp message received';
  if (isAiReplyPlaceholder(text)) return 'AI reply sent';
  if (/^Greeting sent$/i.test(text)) return 'Greeting sent';
  return text;
}
