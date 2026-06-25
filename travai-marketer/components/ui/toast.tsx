'use client';

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface ToastData {
  message: string;
  type?: 'success' | 'error' | 'info';
}

let toastListener: ((data: ToastData | null) => void) | null = null;

export function showToast(data: ToastData) {
  if (toastListener) toastListener(data);
}

export function ToastContainer() {
  const [toast, setToast] = useState<ToastData | null>(null);
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    toastListener = (data) => {
      if (data) {
        setToast(data);
        setVisible(true);
        setLeaving(false);
        setTimeout(() => {
          setLeaving(true);
          setTimeout(() => {
            setVisible(false);
            setToast(null);
          }, 300);
        }, 3000);
      }
    };
    return () => {
      toastListener = null;
    };
  }, []);

  const dismiss = useCallback(() => {
    setLeaving(true);
    setTimeout(() => {
      setVisible(false);
      setToast(null);
    }, 300);
  }, []);

  if (!visible || !toast) return null;

  const typeStyles = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    error: 'border-red-200 bg-red-50 text-red-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
  };

  const icons = {
    success: (
      <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    error: (
      <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    info: (
      <svg className="h-5 w-5 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100]">
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl border px-5 py-3.5 shadow-xl backdrop-blur-sm transition-all duration-300',
          typeStyles[toast.type || 'info'],
          leaving ? 'translate-y-2 opacity-0' : 'translate-y-0 opacity-100'
        )}
      >
        {icons[toast.type || 'info']}
        <span className="text-sm font-medium">{toast.message}</span>
        <button onClick={dismiss} className="ml-2 opacity-50 hover:opacity-100">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
