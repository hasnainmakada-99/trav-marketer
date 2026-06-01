'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/appwrite-client';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

interface Stats {
  totalLeads: number;
  activeConversations: number;
  campaignsSent: number;
  reviewsReplied: number;
  leadsByStatus: { new: number; contacted: number; converted: number; closed: number };
  recentConversations: Array<{ $id: string; phone?: string; message?: string; $createdAt?: string; createdAt?: string }>;
  recentLeads: Array<{ $id: string; name?: string; phone?: string; status?: string; $createdAt?: string; createdAt?: string }>;
}

function ago(ts?: string) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  converted: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-gray-100 text-gray-500',
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ name?: string; email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/stats?teamId=${TEAM_ID}`, { cache: 'no-store' });
      if (res.ok) setStats(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) { router.push('/login'); return; }
        setUser(currentUser as { name?: string; email?: string });
        await loadStats();
      } catch {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router, loadStats]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const statCards = [
    { label: 'Total Leads', value: stats?.totalLeads ?? '—', sub: 'All CRM leads', accent: 'border-emerald-500', icon: '🎯', href: '/dashboard/leads' },
    { label: 'Active (24h)', value: stats?.activeConversations ?? '—', sub: 'Customer messages today', accent: 'border-indigo-500', icon: '💬', href: '/dashboard/whatsapp' },
    { label: 'Campaigns Sent', value: stats?.campaignsSent ?? '—', sub: 'Total broadcasts', accent: 'border-orange-500', icon: '📢', href: '/dashboard/campaigns' },
    { label: 'Reviews Replied', value: stats?.reviewsReplied ?? '—', sub: 'Google review replies', accent: 'border-purple-500', icon: '⭐', href: '/dashboard/gbp' },
  ];

  const leadsTotal = stats ? (stats.leadsByStatus.new + stats.leadsByStatus.contacted + stats.leadsByStatus.converted + stats.leadsByStatus.closed) : 0;

  const features = [
    {
      icon: '💬', color: 'emerald', title: 'WhatsApp AI',
      desc: 'AI-powered customer conversations with instant auto-replies and conversation history.',
      bullets: ['YCloud direct send', 'Conversation inbox', 'Human handover support', 'Customer profiles'],
      btn: 'Open Inbox', href: '/dashboard/whatsapp',
    },
    {
      icon: '🌐', color: 'indigo', title: 'Google Business',
      desc: 'Generate SEO-optimized posts and manage Google reviews with AI-written replies.',
      bullets: ['AI post generation', 'Review management', 'Auto-reply to reviews', 'Schedule and publish'],
      btn: 'Manage GBP', href: '/dashboard/gbp',
    },
    {
      icon: '📢', color: 'blue', title: 'Campaigns',
      desc: 'Broadcast WhatsApp messages to your customer list with targeting and delivery analytics.',
      bullets: ['Bulk messaging', 'Customer targeting', 'Delivery reports', 'Campaign logs'],
      btn: 'View Campaigns', href: '/dashboard/campaigns',
    },
  ];

  const colorMap: Record<string, { btn: string; icon: string }> = {
    emerald: { btn: 'bg-emerald-600 hover:bg-emerald-700', icon: 'text-emerald-500' },
    indigo: { btn: 'bg-indigo-600 hover:bg-indigo-700', icon: 'text-indigo-500' },
    blue: { btn: 'bg-blue-600 hover:bg-blue-700', icon: 'text-blue-500' },
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
    <div className="min-h-screen bg-gray-50 p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {greeting}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Traventions AI command center</p>
        </div>
        <button onClick={loadStats} className="text-xs text-indigo-600 hover:text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50">
          Refresh
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {statCards.map((s) => (
          <button
            key={s.label}
            onClick={() => router.push(s.href)}
            className={`bg-white rounded-xl border-l-4 ${s.accent} shadow-sm p-4 text-left hover:shadow-md transition-shadow`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{s.label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{s.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
              </div>
              <span className="text-lg">{s.icon}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Leads Pipeline Bar */}
      {stats && leadsTotal > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 text-sm">Lead Pipeline</h3>
            <span className="text-xs text-gray-400">{leadsTotal} total leads</span>
          </div>
          <div className="flex rounded-full h-4 overflow-hidden gap-0.5 mb-3">
            {(['new', 'contacted', 'converted', 'closed'] as const).map((s) => {
              const pct = leadsTotal > 0 ? (stats.leadsByStatus[s] / leadsTotal) * 100 : 0;
              if (pct === 0) return null;
              const bg = s === 'new' ? 'bg-blue-400' : s === 'contacted' ? 'bg-yellow-400' : s === 'converted' ? 'bg-emerald-500' : 'bg-gray-300';
              return <div key={s} className={`${bg} transition-all`} style={{ width: `${pct}%` }} title={`${s}: ${stats.leadsByStatus[s]}`} />;
            })}
          </div>
          <div className="flex flex-wrap gap-3">
            {(['new', 'contacted', 'converted', 'closed'] as const).map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-full ${s === 'new' ? 'bg-blue-400' : s === 'contacted' ? 'bg-yellow-400' : s === 'converted' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                <span className="text-xs text-gray-600 capitalize">{s}: <strong>{stats.leadsByStatus[s]}</strong></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* Recent Conversations */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 text-sm">Recent Conversations</h3>
              <button onClick={() => router.push('/dashboard/whatsapp')} className="text-xs text-indigo-600 hover:underline">View all</button>
            </div>
            {stats.recentConversations.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">No conversations yet</p>
            ) : (
              <div className="space-y-2">
                {stats.recentConversations.map((c) => (
                  <div key={c.$id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-xs flex-shrink-0">
                      {(c.phone || '?')[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.phone}</p>
                      <p className="text-xs text-gray-400 truncate">{c.message?.slice(0, 50) || '—'}</p>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{ago(c.$createdAt || c.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Leads */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 text-sm">Recent Leads</h3>
              <button onClick={() => router.push('/dashboard/leads')} className="text-xs text-indigo-600 hover:underline">View all</button>
            </div>
            {stats.recentLeads.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">No leads yet</p>
            ) : (
              <div className="space-y-2">
                {stats.recentLeads.map((l) => (
                  <div key={l.$id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs flex-shrink-0">
                      {(l.name || l.phone || '?')[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{l.name || l.phone}</p>
                      <p className="text-xs text-gray-400 truncate">{l.phone}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[l.status || 'new']}`}>
                      {l.status || 'new'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Feature Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {features.map((f) => {
          const c = colorMap[f.color];
          return (
            <div key={f.title} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{f.icon}</span>
                <h3 className="font-semibold text-gray-900">{f.title}</h3>
              </div>
              <p className="text-sm text-gray-500 mb-3">{f.desc}</p>
              <ul className="space-y-1 text-sm text-gray-600 mb-5 flex-1">
                {f.bullets.map((b) => (
                  <li key={b} className="flex items-center gap-2">
                    <span className="text-emerald-500 text-xs">✓</span>{b}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => router.push(f.href)}
                className={`w-full px-4 py-2.5 text-white rounded-lg text-sm font-medium transition-colors ${c.btn}`}
              >
                {f.btn}
              </button>
            </div>
          );
        })}
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="font-semibold text-gray-900 text-sm mb-3">Quick Actions</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: '✉️', label: 'Send Message', href: '/dashboard/whatsapp' },
            { icon: '📝', label: 'Create GBP Post', href: '/dashboard/gbp' },
            { icon: '⭐', label: 'Reply Reviews', href: '/dashboard/gbp' },
            { icon: '📢', label: 'New Campaign', href: '/dashboard/campaigns' },
          ].map((a) => (
            <button
              key={a.label}
              onClick={() => router.push(a.href)}
              className="flex flex-col items-center gap-2 p-3 rounded-xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50 transition-colors text-center group"
            >
              <span className="text-xl">{a.icon}</span>
              <span className="text-xs font-medium text-gray-600 group-hover:text-indigo-700">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
