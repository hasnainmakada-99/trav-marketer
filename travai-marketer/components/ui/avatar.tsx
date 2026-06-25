'use client';

import { cn } from '@/lib/utils';

interface AvatarProps {
  name?: string | null;
  phone?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

function initials(name?: string | null, phone?: string | null): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (phone) return phone.slice(-2);
  return '??';
}

const sizeMap = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-sm',
  xl: 'h-14 w-14 text-base',
};

const gradients = [
  'from-sky-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-violet-500 to-fuchsia-500',
  'from-rose-500 to-pink-500',
  'from-indigo-500 to-purple-500',
];

function getGradient(name?: string | null): string {
  if (!name) return gradients[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return gradients[Math.abs(hash) % gradients.length];
}

export function Avatar({ name, phone, size = 'md', className }: AvatarProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-2xl bg-gradient-to-br font-bold text-white shadow-lg',
        sizeMap[size],
        getGradient(name),
        className
      )}
    >
      {initials(name, phone)}
    </div>
  );
}
