'use client';

import { cn } from '@/lib/utils';
import { CRM_STATUS_META, type CrmLeadStatus } from '@/lib/crm';

interface StatusBadgeProps {
  status: CrmLeadStatus;
  size?: 'sm' | 'md';
  showDot?: boolean;
  className?: string;
}

export function StatusBadge({ status, size = 'md', showDot = true, className }: StatusBadgeProps) {
  const meta = CRM_STATUS_META[status];
  if (!meta) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold border',
        meta.badge,
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        className
      )}
    >
      {showDot && <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />}
      {meta.shortLabel}
    </span>
  );
}
