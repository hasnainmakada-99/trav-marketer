'use client';

import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  text?: string;
  fullPage?: boolean;
  className?: string;
}

export function LoadingSpinner({ text, fullPage = false, className }: LoadingSpinnerProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-4',
        fullPage ? 'min-h-screen' : 'min-h-[60vh]',
        className
      )}
    >
      <div className="relative">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600" />
        <div className="absolute inset-0 h-10 w-10 animate-pulse rounded-full border-2 border-transparent border-t-emerald-400 opacity-50" />
      </div>
      {text && <p className="mt-4 text-sm text-slate-500">{text}</p>}
    </div>
  );
}
