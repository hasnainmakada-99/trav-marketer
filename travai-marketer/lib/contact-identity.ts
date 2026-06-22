import { normalizePhoneForMatch, sanitizeLeadName } from '@/lib/crm';

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function toTitleCase(value: string) {
  return value
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function looksLikeNameCandidate(value: string, phone?: string | null) {
  const trimmed = normalizeSpaces(value);
  if (!trimmed) return false;
  if (!/[a-zA-Z]/.test(trimmed)) return false;
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  if (/\b(today|tomorrow|pm|am|callback|call back|call me|whatsapp|google|invoice)\b/i.test(trimmed)) {
    return false;
  }

  const normalizedCandidatePhone = normalizePhoneForMatch(trimmed);
  const normalizedPhone = normalizePhoneForMatch(phone);
  if (normalizedCandidatePhone && normalizedCandidatePhone === normalizedPhone) {
    return false;
  }

  return true;
}

export function extractCustomerNameCandidate(
  message: string | null | undefined,
  phone?: string | null
): string | null {
  const text = normalizeSpaces(String(message || ''));
  if (!text) return null;

  const patterns = [
    /\bmy name is\s+([a-z][a-z\s.'-]{1,50})$/i,
    /\bname is\s+([a-z][a-z\s.'-]{1,50})$/i,
    /^([a-z][a-z\s.'-]{1,50}),\s*(?:\+?\d[\d\s-]{7,}.*)?$/i,
    /^([a-z][a-z\s.'-]{1,50})\s+is my full name$/i,
    /^([a-z][a-z\s.'-]{1,50})\s*,\s*(?:today|tomorrow|anytime|\+?\d)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = normalizeSpaces(match?.[1] || '');
    if (!candidate || !looksLikeNameCandidate(candidate, phone)) {
      continue;
    }
    return sanitizeLeadName(toTitleCase(candidate), phone) || null;
  }

  return null;
}

export function extractCustomerNameFromMessages(
  messages: Array<{ message?: string | null }>,
  phone?: string | null
) {
  for (const item of messages) {
    const extracted = extractCustomerNameCandidate(item.message, phone);
    if (extracted) {
      return extracted;
    }
  }
  return null;
}

export function getContactDisplayLabel(params: {
  customerName?: string | null;
  leadName?: string | null;
  phone?: string | null;
  source?: string | null;
}) {
  const preferred =
    sanitizeLeadName(params.customerName, params.phone) ||
    sanitizeLeadName(params.leadName, params.phone);

  if (preferred) {
    return preferred;
  }

  if (params.source === 'walk_in') {
    return 'Walk-in lead';
  }

  return 'WhatsApp contact';
}
