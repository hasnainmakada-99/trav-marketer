function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function extractBracketPlaceholderType(value: string | null | undefined) {
  const text = normalizeWhitespace(String(value || ''));
  const match = text.match(/^\[([a-z_]+)\]$/i);
  return match?.[1]?.toLowerCase() || null;
}

export function isUnsupportedMessage(value: string | null | undefined) {
  return normalizeWhitespace(String(value || '')).toLowerCase() === '[unsupported]';
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
  const raw = String(value || '');
  const text = normalizeWhitespace(raw);
  const explicitMessageType = String(options?.messageType || '').trim().toLowerCase();
  const placeholderType = extractBracketPlaceholderType(text);
  const messageType = placeholderType || explicitMessageType;
  const direction = options?.direction || null;

  if (messageType === 'unsupported' || messageType === 'media') {
    return direction === 'outgoing'
      ? 'Media message sent'
      : 'Media message received';
  }

  if (messageType === 'revoke') {
    return 'Deleted WhatsApp message';
  }

  if (messageType === 'image') return 'Photo attachment';
  if (messageType === 'audio' || messageType === 'voice') return 'Voice note';
  if (messageType === 'video') return 'Video attachment';
  if (messageType === 'document') return 'Document attachment';
  if (messageType === 'sticker') return 'Sticker message';
  if (messageType === 'location') return 'Location shared';

  if (text && !isUnsupportedMessage(text)) {
    if (isWhatsAppMessageId(text)) {
      return direction === 'outgoing' ? 'WhatsApp message sent' : 'WhatsApp message received';
    }
    if (isAiReplyPlaceholder(text)) {
      return 'AI reply sent';
    }
    if (/^Greeting sent$/i.test(text)) {
      return 'Greeting sent';
    }
    // Preserve original formatting (line breaks, bullets, markdown) for real
    // message text — only trim outer whitespace.
    return raw.trim();
  }

  if (messageType === 'image') return 'Photo attachment';
  if (messageType === 'audio' || messageType === 'voice') return 'Voice note';
  if (messageType === 'video') return 'Video attachment';
  if (messageType === 'document') return 'Document attachment';
  if (messageType && messageType !== 'text') return `${messageType} attachment`;
  return direction === 'outgoing' ? 'Message sent' : 'Message received';
}

export function hasUsefulConversationText(value: string | null | undefined) {
  const text = normalizeWhitespace(String(value || ''));
  if (!text) return false;
  if (isUnsupportedMessage(text)) return false;
  if (isWhatsAppMessageId(text)) return false;
  if (extractBracketPlaceholderType(text)) return false;
  if (isAiReplyPlaceholder(text)) return false;
  if (/^Greeting sent$/i.test(text)) return false;
  return true;
}

export function humanizeLeadNotes(value: string | null | undefined) {
  const raw = String(value || '');
  const text = normalizeWhitespace(raw);
  if (!text) return null;
  if (isWhatsAppMessageId(text)) return 'WhatsApp message received';
  if (isUnsupportedMessage(text)) return null;
  if (isAiReplyPlaceholder(text)) return 'AI reply sent';
  if (/^Greeting sent$/i.test(text)) return 'Greeting sent';
  return raw.trim();
}

export function buildBestConversationPreview(
  conversations: Array<{
    message?: string | null;
    messageType?: string | null;
    role?: 'user' | 'assistant' | null;
    sentBy?: 'customer' | 'ai' | 'staff' | null;
  }>
) {
  for (const conversation of conversations) {
    if (hasUsefulConversationText(conversation.message)) {
      return normalizeWhitespace(String(conversation.message || '')).slice(0, 300);
    }
  }

  for (const conversation of conversations) {
    const direction =
      conversation.role === 'user' || conversation.sentBy === 'customer' ? 'incoming' : 'outgoing';
    const preview = humanizeMessagePreview(conversation.message, {
      messageType: conversation.messageType,
      direction,
    });
    if (preview) {
      return preview.slice(0, 300);
    }
  }

  return null;
}

export function buildBestLeadPreview(
  conversations: Array<{
    message?: string | null;
    messageType?: string | null;
    role?: 'user' | 'assistant' | null;
    sentBy?: 'customer' | 'ai' | 'staff' | null;
  }>
) {
  const incoming = conversations.filter(
    (conversation) => conversation.role === 'user' || conversation.sentBy === 'customer'
  );

  for (const conversation of incoming) {
    if (hasUsefulConversationText(conversation.message)) {
      return normalizeWhitespace(String(conversation.message || '')).slice(0, 300);
    }
  }

  for (const conversation of incoming) {
    const preview = humanizeMessagePreview(conversation.message, {
      messageType: conversation.messageType,
      direction: 'incoming',
    });
    if (preview && !/^message received$/i.test(preview) && !/^whatsapp message received$/i.test(preview)) {
      return preview.slice(0, 300);
    }
  }

  for (const conversation of conversations) {
    if (hasUsefulConversationText(conversation.message)) {
      return normalizeWhitespace(String(conversation.message || '')).slice(0, 300);
    }
  }

  for (const conversation of conversations) {
    const direction =
      conversation.role === 'user' || conversation.sentBy === 'customer' ? 'incoming' : 'outgoing';
    const preview = humanizeMessagePreview(conversation.message, {
      messageType: conversation.messageType,
      direction,
    });
    if (preview && !/^message sent$/i.test(preview) && !/^whatsapp message sent$/i.test(preview)) {
      return preview.slice(0, 300);
    }
  }

  return null;
}
