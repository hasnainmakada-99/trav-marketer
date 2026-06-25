'use client';

import { cn } from '@/lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  padding?: 'sm' | 'md' | 'lg';
}

const paddingMap = {
  sm: 'p-4 sm:p-5',
  md: 'p-5 sm:p-6',
  lg: 'p-6 sm:p-8',
};

export function Card({ children, className, hover = false, padding = 'md' }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[28px] border border-slate-200 bg-white/90 shadow-xl shadow-slate-200/60 backdrop-blur-sm',
        paddingMap[padding],
        hover && 'transition hover:-translate-y-0.5 hover:shadow-2xl',
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between', className)}>
      {children}
    </div>
  );
}

export function CardTitle({
  label,
  title,
  className,
}: {
  label?: string;
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn(className)}>
      {label && (
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</p>
      )}
      {title && <h2 className="mt-2 text-2xl font-semibold text-slate-950">{title}</h2>}
    </div>
  );
}
