'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/appwrite-client';
import { CRM_STATUS_META, CRM_STATUS_ORDER, type CrmLeadStatus } from '@/lib/crm';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

interface Stats {
  totalLeads: number;
  activeConversations: number;
  campaignsSent: number;
  reviewsReplied: number;
  leadsByStatus: Record<CrmLeadStatus, number>;
  statusOrder: CrmLeadStatus[];
  recentConversations: Array<{
    $id: string;
    phone?: string;
    name?: string;
    message?: string;
    $createdAt?: string;
    createdAt?: string;
  }>;
  recentLeads: Array<{
    $id: string;
    name?: string;
    phone?: string;
    status?: CrmLeadStatus;
    $createdAt?: string;
    createdAt?: string;
  }>;
}

function ago(ts?: string) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ name?: string; email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const response = await fetch(`/api/dashboard/stats?teamId=${TEAM_ID}`, { cache: 'no-store' });
      if (response.ok) {
        setStats(await response.json());
      }
    } catch {
      // keep existing dashboard state
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          router.push('/login');
          return;
        }
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

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const statCards = [
    {
      label: 'Total Leads',
      value: stats?.totalLeads ?? '—',
      sub: 'All live CRM leads',
      href: '/dashboard/leads',
      panel: 'from-sky-500 to-cyan-500',
    },
    {
      label: 'Active Chats',
      value: stats?.activeConversations ?? '—',
      sub: 'Customer messages in the last 24h',
      href: '/dashboard/whatsapp',
      panel: 'from-emerald-500 to-teal-500',
    },
    {
      label: 'Campaigns Sent',
      value: stats?.campaignsSent ?? '—',
      sub: 'Broadcasts already delivered',
      href: '/dashboard/campaigns',
      panel: 'from-amber-500 to-orange-500',
    },
    {
      label: 'Reviews Replied',
      value: stats?.reviewsReplied ?? '—',
      sub: 'Google reviews with AI reply',
      href: '/dashboard/gbp',
      panel: 'from-violet-500 to-fuchsia-500',
    },
  ];

  const totalPipeline = stats
    ? CRM_STATUS_ORDER.reduce((sum, status) => sum + (stats.leadsByStatus?.[status] || 0), 0)
    : 0;

  const featureCards = [
    {
      title: 'WhatsApp CRM',
      desc: 'See full chat history, CRM stages, callback handling, and contact identities in one inbox.',
      href: '/dashboard/whatsapp',
      cta: 'Open WhatsApp desk',
    },
    {
      title: 'Lead Pipeline',
      desc: 'Track AI-qualified leads from New Lead to Converted, then hand off invoices or staff action.',
      href: '/dashboard/leads',
      cta: 'Open lead pipeline',
    },
    {
      title: 'Campaign Engine',
      desc: 'Broadcast follow-ups and offers with a repaired campaign send flow and clearer delivery states.',
      href: '/dashboard/campaigns',
      cta: 'Manage campaigns',
    },
  ];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-10 w-10 animate-spin rounded-full border-b-2 border-emerald-600" />
          <p className="mt-3 text-sm text-slate-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-6">
      <div className="rounded-[34px] border border-slate-200 bg-[linear-gradient(135deg,#07111f_0%,#0f172a_42%,#0f766e_100%)] px-6 py-7 text-white shadow-2xl shadow-slate-200/70">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-200">
              Traventions Command Center
            </p>
            <h1 className="mt-3 text-4xl font-semibold">
              {greeting}
              {user?.name ? `, ${user.name.split(' ')[0]}` : ''}
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-200">
              The CRM now treats WhatsApp as the front desk for sales: contact-aware inbox,
              callback capture with email confirmation, and AI lead stages that stay visible to the team.
            </p>
          </div>
          <button
            onClick={loadStats}
            className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
          >
            Refresh dashboard
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <button
            key={card.label}
            onClick={() => router.push(card.href)}
            className="rounded-[28px] border border-slate-200 bg-white/90 p-5 text-left shadow-xl shadow-slate-200/60 transition hover:-translate-y-0.5 hover:shadow-2xl"
          >
            <div className={`inline-flex rounded-2xl bg-gradient-to-br ${card.panel} px-3 py-2 text-sm font-semibold text-white`}>
              {card.label}
            </div>
            <p className="mt-5 text-4xl font-semibold text-slate-950">{card.value}</p>
            <p className="mt-1 text-sm text-slate-500">{card.sub}</p>
          </button>
        ))}
      </div>

      {stats && totalPipeline > 0 && (
        <div className="mt-6 rounded-[30px] border border-slate-200 bg-white/90 p-6 shadow-xl shadow-slate-200/60">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Lead pipeline</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                Frontline lead CRM powered by the WhatsApp bot
              </h2>
            </div>
            <p className="text-sm text-slate-400">{totalPipeline} total tracked leads</p>
          </div>

          <div className="mt-5 flex h-5 overflow-hidden rounded-full bg-slate-100">
            {CRM_STATUS_ORDER.map((status) => {
              const count = stats.leadsByStatus?.[status] || 0;
              if (!count) return null;
              const width = `${(count / totalPipeline) * 100}%`;
              return (
                <div
                  key={status}
                  className={CRM_STATUS_META[status].dot}
                  style={{ width }}
                  title={`${CRM_STATUS_META[status].label}: ${count}`}
                />
              );
            })}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {CRM_STATUS_ORDER.map((status) => (
              <button
                key={status}
                onClick={() => router.push('/dashboard/leads')}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:bg-white"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${CRM_STATUS_META[status].dot}`} />
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {CRM_STATUS_META[status].shortLabel}
                  </span>
                </div>
                <p className="mt-3 text-3xl font-semibold text-slate-950">
                  {stats.leadsByStatus?.[status] || 0}
                </p>
                <p className="mt-1 text-sm text-slate-500">{CRM_STATUS_META[status].label}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[30px] border border-slate-200 bg-white/90 p-6 shadow-xl shadow-slate-200/60">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Recent activity</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">WhatsApp and lead updates</h2>
            </div>
            <button
              onClick={() => router.push('/dashboard/whatsapp')}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Open inbox
            </button>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[26px] border border-slate-100 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Recent conversations</h3>
              <div className="mt-4 space-y-3">
                {stats?.recentConversations?.length ? (
                  stats.recentConversations.map((conversation) => (
                    <div key={conversation.$id} className="rounded-2xl border border-white bg-white px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">
                            {conversation.name || conversation.phone}
                          </p>
                          <p className="truncate text-xs text-slate-400">{conversation.phone}</p>
                        </div>
                        <span className="text-xs text-slate-400">{ago(conversation.$createdAt || conversation.createdAt)}</span>
                      </div>
                      <p className="mt-2 truncate text-sm text-slate-500">{conversation.message || '—'}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">No conversations yet.</p>
                )}
              </div>
            </div>

            <div className="rounded-[26px] border border-slate-100 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Recent leads</h3>
              <div className="mt-4 space-y-3">
                {stats?.recentLeads?.length ? (
                  stats.recentLeads.map((lead) => (
                    <div key={lead.$id} className="rounded-2xl border border-white bg-white px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">{lead.name || lead.phone}</p>
                          <p className="truncate text-xs text-slate-400">{lead.phone}</p>
                        </div>
                        {lead.status && (
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${CRM_STATUS_META[lead.status].badge}`}>
                            {CRM_STATUS_META[lead.status].label}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-slate-400">{ago(lead.$createdAt || lead.createdAt)}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">No leads yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {featureCards.map((card) => (
            <div
              key={card.title}
              className="rounded-[30px] border border-slate-200 bg-white/90 p-6 shadow-xl shadow-slate-200/60"
            >
              <h3 className="text-2xl font-semibold text-slate-950">{card.title}</h3>
              <p className="mt-2 text-sm text-slate-500">{card.desc}</p>
              <button
                onClick={() => router.push(card.href)}
                className="mt-5 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                {card.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
