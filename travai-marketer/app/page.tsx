'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { account } from '@/lib/appwrite-client';

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        await account.get();
        router.replace('/dashboard');
      } catch {
        router.replace('/login');
      }
    };
    check();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="text-center">
        <div className="relative mx-auto h-14 w-14">
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-emerald-400" />
          <div className="absolute inset-1 animate-pulse rounded-full border-2 border-transparent border-t-emerald-600" />
          <div className="absolute inset-3 flex items-center justify-center">
            <span className="text-sm font-bold text-emerald-400">T</span>
          </div>
        </div>
        <p className="mt-5 text-sm text-slate-500">Redirecting...</p>
      </div>
    </div>
  );
}
