'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/appwrite-client';

interface QuickStat {
  label: string;
  value: string | number;
  sub: string;
  accent: string;
  icon: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ name?: string; email?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const currentUser = await getCurrentUser();
        setUser(currentUser as { name?: string; email?: string });
      } catch {
        router.push('/login');
        return;
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const stats: QuickStat[] = [
    {
      label: 'WhatsApp Channel',
      value: 'YCloud Active',
      sub: 'Bridge removed, cloud delivery only',
      accent: 'border-emerald-500',
      icon: 'WA',
    },
    { label: 'AI Replies', value: 'Active', sub: 'Auto-replies enabled', accent: 'border-indigo-500', icon: 'AI' },
    { label: 'GBP Posts', value: 'Ready', sub: 'AI post generation live', accent: 'border-orange-500', icon: 'GBP' },
    { label: 'Review AI', value: 'Active', sub: 'Auto-reply on Google', accent: 'border-purple-500', icon: 'REV' },
  ];

  const features = [
    {
      icon: 'WA',
      color: 'emerald',
      title: 'WhatsApp AI',
      desc: 'AI-powered customer conversations with instant auto-replies and conversation history.',
      bullets: ['YCloud direct send', 'Conversation inbox', 'Human handover support', 'Customer profiles'],
      btn: 'Open Inbox',
      href: '/dashboard/whatsapp',
    },
    {
      icon: 'GBP',
      color: 'indigo',
      title: 'Google Business',
      desc: 'Generate SEO-optimized posts and manage Google reviews with AI-written replies.',
      bullets: ['AI post generation', 'Review management', 'Auto-reply to reviews', 'Schedule and publish'],
      btn: 'Manage GBP',
      href: '/dashboard/gbp',
    },
    {
      icon: 'CMP',
      color: 'blue',
      title: 'Campaigns',
      desc: 'Broadcast WhatsApp messages to your customer list with targeting and delivery analytics.',
      bullets: ['Bulk messaging', 'Customer targeting', 'Delivery reports', 'Campaign logs'],
      btn: 'Coming Soon',
      href: null,
    },
  ];

  const colorMap: Record<string, { btn: string; icon: string; border: string }> = {
    emerald: { btn: 'bg-emerald-600 hover:bg-emerald-700', icon: 'text-emerald-500', border: 'border-emerald-100' },
    indigo: { btn: 'bg-indigo-600 hover:bg-indigo-700', icon: 'text-indigo-500', border: 'border-indigo-100' },
    blue: { btn: 'bg-gray-300 cursor-not-allowed', icon: 'text-blue-400', border: 'border-blue-100' },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
          <p className="mt-3 text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {greeting}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
        </h1>
        <p className="text-sm text-gray-500 mt-1">Here is your Traventions AI command center.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className={`bg-white rounded-xl border-l-4 ${s.accent} shadow-sm p-5`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{s.label}</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{s.value}</p>
                <p className="text-xs text-gray-400 mt-1">{s.sub}</p>
              </div>
              <span className="text-sm font-semibold text-gray-500">{s.icon}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-8 flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm text-emerald-700">WhatsApp is running on YCloud only</p>
          <p className="text-xs text-emerald-700/80">Bridge services and WA-Web dependencies have been removed from the app.</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/whatsapp')}
          className="shrink-0 px-4 py-2 bg-white border border-emerald-200 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-100 transition-colors shadow-sm"
        >
          Open WhatsApp
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {features.map((f) => {
          const c = colorMap[f.color];
          return (
            <div key={f.title} className={`bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col`}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-sm font-semibold ${c.icon}`}>{f.icon}</span>
                <h3 className="font-semibold text-gray-900">{f.title}</h3>
              </div>
              <p className="text-sm text-gray-500 mb-4">{f.desc}</p>
              <ul className="space-y-1.5 text-sm text-gray-600 mb-6 flex-1">
                {f.bullets.map((b) => (
                  <li key={b} className="flex items-center gap-2">
                    <span className="text-emerald-500 text-xs">OK</span>
                    {b}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => f.href && router.push(f.href)}
                disabled={!f.href}
                className={`w-full px-4 py-2.5 text-white rounded-lg text-sm font-medium transition-colors ${c.btn}`}
              >
                {f.btn}
              </button>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: 'MSG', label: 'Send Message', href: '/dashboard/whatsapp' },
            { icon: 'POST', label: 'Create GBP Post', href: '/dashboard/gbp' },
            { icon: 'REV', label: 'Reply Reviews', href: '/dashboard/gbp' },
            { icon: 'WA', label: 'WhatsApp Inbox', href: '/dashboard/whatsapp' },
          ].map((a) => (
            <button
              key={a.label}
              onClick={() => router.push(a.href)}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50 transition-colors text-center group"
            >
              <span className="text-xs font-bold text-gray-400">{a.icon}</span>
              <span className="text-xs font-medium text-gray-600 group-hover:text-indigo-700">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
