export const CRM_STATUS_ORDER = [
  'new_lead',
  'normal_conversation',
  'connected',
  'converted',
  'closed',
] as const;

export type CrmLeadStatus = (typeof CRM_STATUS_ORDER)[number];

export const CRM_STATUS_META: Record<
  CrmLeadStatus,
  {
    label: string;
    shortLabel: string;
    dot: string;
    badge: string;
    soft: string;
    panel: string;
  }
> = {
  new_lead: {
    label: 'New Lead',
    shortLabel: 'New',
    dot: 'bg-sky-500',
    badge: 'bg-sky-100 text-sky-700 border border-sky-200',
    soft: 'bg-sky-50 text-sky-700',
    panel: 'from-sky-500 to-cyan-500',
  },
  normal_conversation: {
    label: 'Normal Conversation',
    shortLabel: 'Normal',
    dot: 'bg-violet-500',
    badge: 'bg-violet-100 text-violet-700 border border-violet-200',
    soft: 'bg-violet-50 text-violet-700',
    panel: 'from-violet-500 to-fuchsia-500',
  },
  connected: {
    label: 'Connected',
    shortLabel: 'Connected',
    dot: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-700 border border-amber-200',
    soft: 'bg-amber-50 text-amber-700',
    panel: 'from-amber-500 to-orange-500',
  },
  converted: {
    label: 'Converted',
    shortLabel: 'Converted',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    soft: 'bg-emerald-50 text-emerald-700',
    panel: 'from-emerald-500 to-teal-500',
  },
  closed: {
    label: 'Closed',
    shortLabel: 'Closed',
    dot: 'bg-slate-500',
    badge: 'bg-slate-100 text-slate-700 border border-slate-200',
    soft: 'bg-slate-50 text-slate-700',
    panel: 'from-slate-500 to-slate-700',
  },
};

const LEGACY_STATUS_MAP: Record<string, CrmLeadStatus> = {
  new: 'new_lead',
  contacted: 'connected',
  converted: 'converted',
  closed: 'closed',
  new_lead: 'new_lead',
  normal_conversation: 'normal_conversation',
  connected: 'connected',
};

const CONVERTED_REGEX =
  /\b(confirm|confirmed|proceed|proceeding|go ahead|book it|book now|continue booking|yes book|finalise|finalize|lock it|done with this|take this package)\b/i;
const CLOSED_REGEX =
  /\b(not interested|stop|cancel|cancelled|canceled|close this|close lead|no thanks|no thank you|drop this|end this|remove me)\b/i;
const CALLBACK_REGEX =
  /\b(arrange callback|callback|call me|call back|schedule a call|preferred time|talk to expert)\b/i;

export function normalizePhoneForMatch(input: string | null | undefined): string {
  return String(input || '').replace(/\D/g, '');
}

export function buildPhoneVariants(input: string | null | undefined): string[] {
  const normalized = normalizePhoneForMatch(input);
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);
  if (normalized.startsWith('91') && normalized.length > 10) {
    variants.add(normalized.slice(2));
  }
  if (normalized.length === 10) {
    variants.add(`91${normalized}`);
  }
  if (normalized.startsWith('0') && normalized.length > 10) {
    variants.add(normalized.slice(1));
  }
  return [...variants].filter(Boolean);
}

export function coerceLeadStatus(input: string | null | undefined): CrmLeadStatus {
  const normalized = String(input || '').trim().toLowerCase();
  return LEGACY_STATUS_MAP[normalized] || 'new_lead';
}

export function compareLeadStatus(a: string | null | undefined, b: string | null | undefined): number {
  return CRM_STATUS_ORDER.indexOf(coerceLeadStatus(a)) - CRM_STATUS_ORDER.indexOf(coerceLeadStatus(b));
}

export function mergeLeadStatus(
  current: string | null | undefined,
  next: string | null | undefined
): CrmLeadStatus {
  const currentSafe = coerceLeadStatus(current);
  const nextSafe = coerceLeadStatus(next);
  return compareLeadStatus(currentSafe, nextSafe) >= 0 ? currentSafe : nextSafe;
}

export function isConversionIntent(message: string | null | undefined): boolean {
  return CONVERTED_REGEX.test(String(message || ''));
}

export function isClosedIntent(message: string | null | undefined): boolean {
  return CLOSED_REGEX.test(String(message || ''));
}

export function isCallbackIntent(message: string | null | undefined): boolean {
  return CALLBACK_REGEX.test(String(message || ''));
}

export function getStatusLabel(status: string | null | undefined): string {
  return CRM_STATUS_META[coerceLeadStatus(status)].label;
}

export function getDisplayName(params: {
  customerName?: string | null;
  leadName?: string | null;
  phone?: string | null;
}): string {
  const bestName = params.customerName?.trim() || params.leadName?.trim();
  return bestName || params.phone || 'Unknown';
}

export function deriveLeadStatus(params: {
  existingStatus?: string | null;
  isFirstLead?: boolean;
  workflowIntent?: string | null;
  workflowStage?: string | null;
  workflowSlots?: Record<string, string | undefined> | null;
  userMessage?: string | null;
}): CrmLeadStatus {
  const message = String(params.userMessage || '');
  if (isClosedIntent(message)) {
    return 'closed';
  }
  if (isConversionIntent(message)) {
    return 'converted';
  }

  const stage = String(params.workflowStage || '');
  const intent = String(params.workflowIntent || '');
  const slots = params.workflowSlots || {};
  const hasLeadDetails = Boolean(slots.name || slots.phone || slots.email);
  const hasCallbackTime = Boolean(slots.callback_time);
  const isCallbackFlow =
    intent === 'callback_request' ||
    stage === 'collect_lead' ||
    stage === 'ask_callback' ||
    hasCallbackTime ||
    isCallbackIntent(message);

  if (stage === 'confirmed') {
    return hasCallbackTime ? 'connected' : 'converted';
  }
  if (isCallbackFlow || hasLeadDetails) {
    return 'connected';
  }
  if (params.isFirstLead) {
    return 'new_lead';
  }
  return mergeLeadStatus(params.existingStatus, 'normal_conversation');
}

export function buildStatusCounts(items: Array<{ status?: string | null }>): Record<CrmLeadStatus, number> {
  const counts = Object.fromEntries(CRM_STATUS_ORDER.map((status) => [status, 0])) as Record<
    CrmLeadStatus,
    number
  >;
  for (const item of items) {
    counts[coerceLeadStatus(item.status)] += 1;
  }
  return counts;
}
