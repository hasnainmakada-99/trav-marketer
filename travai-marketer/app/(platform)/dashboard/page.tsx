'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/appwrite-client';
import { CRM_STATUS_META, CRM_STATUS_ORDER, type CrmLeadStatus } from '@/lib/crm';
import { Card, CardTitle } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { showToast } from '@/components/ui/toast';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

interface Stats {
  totalLeads: number;
  activeConversations: number;
  campaignsSent: number;
  reviewsReplied: number;
  leadsByStatus: Record<CrmLeadStatus, number>;
  statusOrder: CrmLeadStatus[];
  recentConversations: Array<{
    $id: string; phone?: string; name?: string; message?: string; $createdAt?: string; createdAt?: string;
  }>;
  recentLeads: Array<{
    $id: string; name?: string; phone?: string; status?: CrmLeadStatus; $createdAt?: string; createdAt?: string;
  }>;
  revenue?: {
    total: number;
    monthly: number;
    byService: Record<string, number>;
    transactionCount: number;
  };
}

interface KnowledgeStatus {
  totalRecords: number;
  activeRecords: number;
  lastSyncedAt: string | null;
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
  const [authLoading, setAuthLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [knowledgeStatus, setKnowledgeStatus] = useState<KnowledgeStatus | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeSyncing, setKnowledgeSyncing] = useState(false);
  const [showDashboardMissedCall, setShowDashboardMissedCall] = useState(false);
  const [dashMissedForm, setDashMissedForm] = useState({ phone: '', name: '' });
  const [dashMissedSaving, setDashMissedSaving] = useState(false);

  const loadStats = useCallback(async (options?: { silent?: boolean; forceFresh?: boolean }) => {
    const silent = options?.silent ?? false;
    const forceFresh = options?.forceFresh ?? false;
    if (!silent) setRefreshing(true);
    setStatsLoading((current) => current || !silent);
    try {
      const params = new URLSearchParams({ teamId: TEAM_ID });
      if (forceFresh) params.set('refresh', '1');
      const response = await fetch(`/api/dashboard/stats?${params.toString()}`, { cache: 'no-store' });
      if (response.ok) setStats(await response.json());
    } catch {
      // keep existing state
    } finally {
      setStatsLoading(false);
      if (!silent) setRefreshing(false);
    }
  }, []);

  const loadKnowledgeStatus = useCallback(async () => {
    setKnowledgeLoading(true);
    try {
      const response = await fetch(`/api/knowledge/train?teamId=${encodeURIComponent(TEAM_ID)}`, { cache: 'no-store' });
      if (response.ok) setKnowledgeStatus(await response.json());
    } finally {
      setKnowledgeLoading(false);
    }
  }, []);

  const syncKnowledge = useCallback(async () => {
    setKnowledgeSyncing(true);
    try {
      const response = await fetch('/api/knowledge/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: TEAM_ID }),
      });
      if (response.ok) setKnowledgeStatus(await response.json());
    } finally {
      setKnowledgeSyncing(false);
    }
  }, []);

  const handleDashboardMissedCall = useCallback(async () => {
    const phone = dashMissedForm.phone.replace(/[^\d+]/g, '');
    if (!phone || phone.length < 8) { showToast({ message: 'Valid phone number required', type: 'error' }); return; }
    setDashMissedSaving(true);
    try {
      const res = await fetch('/api/calls/missed', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name: dashMissedForm.name || undefined, teamId: TEAM_ID }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      showToast({ message: 'Missed call logged — WhatsApp follow-up sent', type: 'success' });
      setShowDashboardMissedCall(false);
      setDashMissedForm({ phone: '', name: '' });
    } catch (e) { showToast({ message: e instanceof Error ? e.message : 'Failed', type: 'error' }); }
    finally { setDashMissedSaving(false); }
  }, [dashMissedForm, TEAM_ID]);

  useEffect(() => {
    const init = async () => {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) { router.push('/login'); return; }
        setUser(currentUser as { name?: string; email?: string });
        void loadStats();
        void loadKnowledgeStatus();
      } catch {
        router.push('/login');
      } finally {
        setAuthLoading(false);
      }
    };
    void init();
  }, [router, loadKnowledgeStatus, loadStats]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const totalPipeline = stats
    ? CRM_STATUS_ORDER.reduce((sum, status) => sum + (stats.leadsByStatus?.[status] || 0), 0)
    : 0;

  const conversionMetrics = useMemo(() => {
    if (!stats) return null;
    const totalLeads = stats.totalLeads || 0;
    const transactionCount = stats.revenue?.transactionCount || 0;
    const totalRevenue = stats.revenue?.total || 0;
    return {
      conversionRate: totalLeads > 0 ? Math.round((transactionCount / totalLeads) * 100) : 0,
      leadsInPipeline: totalLeads,
      transactions: transactionCount,
      revenuePerLead: totalLeads > 0 ? `\u20b9${(totalRevenue / totalLeads).toFixed(0)}` : '\u20b90',
    };
  }, [stats]);

  async function downloadExport(type: string) {
    const res = await fetch(`/api/export?type=${type}&format=csv&teamId=${TEAM_ID}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (authLoading) return <LoadingSpinner text="Loading dashboard..." fullPage />;

  return (
    <div className="min-h-full space-y-6 p-4 sm:p-6 xl:p-8">

      {/* Welcome hero */}
      <div className="relative overflow-hidden rounded-[34px] bg-[linear-gradient(135deg,#07111f_0%,#0f172a_42%,#0f766e_100%)] px-6 py-8 shadow-2xl sm:px-8 sm:py-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.15)_0%,transparent_50%),radial-gradient(ellipse_at_bottom_left,rgba(6,182,212,0.1)_0%,transparent_50%)]" />
        <div className="relative">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
            Traventions Command Center
          </div>
          <h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl xl:text-5xl">
            {greeting}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-200 sm:text-base">
            Manage GBP, WhatsApp, campaigns, and lead follow-up from one consolidated workspace.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => router.push('/dashboard/gbp')}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg transition hover:bg-emerald-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
              </svg>
              Open GBP workspace
            </button>
            <button
              onClick={() => void syncKnowledge()}
              disabled={knowledgeSyncing}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/20 px-5 py-3 text-sm font-semibold text-emerald-200 backdrop-blur transition hover:bg-emerald-400/20 disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
              {knowledgeSyncing ? 'Training AI...' : 'Train AI knowledge'}
            </button>
            <button
              onClick={() => setShowDashboardMissedCall(true)}
              className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/20 px-5 py-3 text-sm font-semibold text-amber-200 backdrop-blur transition hover:bg-amber-400/20"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5.25h18M3 12h18M3 18.25h18" />
              </svg>
              Log Missed Call
            </button>
            <button
              onClick={() => void loadStats({ forceFresh: true })}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-50"
            >
              <svg className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {/* Live metrics */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Active chats</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">
                {stats?.activeConversations ?? (statsLoading ? '...' : 0)}
              </p>
              <p className="mt-1 text-sm text-slate-500">WhatsApp conversations needing attention</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Reviews replied</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">
                {stats?.reviewsReplied ?? (statsLoading ? '...' : 0)}
              </p>
              <p className="mt-1 text-sm text-slate-500">Google reviews answered with AI</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">AI knowledge</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">
                {knowledgeStatus?.activeRecords ?? (knowledgeLoading ? '...' : 0)}
              </p>
              <p className="mt-1 text-sm text-slate-500">Package records ready for AI answers</p>
              <p className="mt-2 text-xs text-slate-400">
                Last sync {knowledgeStatus?.lastSyncedAt ? ago(knowledgeStatus.lastSyncedAt) : 'not yet'}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
              </svg>
            </div>
          </div>
        </Card>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {[
          { label: 'Total Leads', value: stats?.totalLeads, sub: 'All live CRM leads', href: '/dashboard/leads', color: 'from-sky-500 to-cyan-500' },
          { label: 'Active Chats', value: stats?.activeConversations, sub: 'Messages in last 24h', href: '/dashboard/whatsapp', color: 'from-emerald-500 to-teal-500' },
          { label: 'Campaigns Sent', value: stats?.campaignsSent, sub: 'Broadcasts delivered', href: '/dashboard/campaigns', color: 'from-amber-500 to-orange-500' },
          { label: 'Reviews Replied', value: stats?.reviewsReplied, sub: 'Google reviews with AI', href: '/dashboard/gbp', color: 'from-violet-500 to-fuchsia-500' },
          { label: 'Total Revenue', value: stats?.revenue ? `$${stats.revenue.total.toLocaleString()}` : undefined, sub: `${stats?.revenue?.transactionCount ?? 0} transactions`, href: '#', color: 'from-emerald-600 to-green-500' },
          { label: 'Monthly Revenue', value: stats?.revenue ? `$${stats.revenue.monthly.toLocaleString()}` : undefined, sub: 'Current month', href: '#', color: 'from-teal-500 to-cyan-500' },
        ].map((card) => (
          <button
            key={card.label}
            onClick={() => router.push(card.href)}
            className="group rounded-[28px] border border-slate-200 bg-white/90 p-5 text-left shadow-xl shadow-slate-200/60 transition hover:-translate-y-0.5 hover:shadow-2xl"
          >
            <div className={`inline-flex rounded-2xl bg-gradient-to-br ${card.color} px-3 py-2 text-sm font-semibold text-white`}>
              {card.label}
            </div>
            <p className="mt-5 text-3xl font-semibold text-slate-950 sm:text-4xl">
              {card.value ?? (statsLoading ? '...' : 0)}
            </p>
            <p className="mt-1 text-sm text-slate-500">{card.sub}</p>
          </button>
        ))}
      </div>

      {/* Conversion Metrics */}
      <Card>
        <CardTitle label="Lead Conversion Metrics" title="Pipeline performance overview" />
        <div className="mt-5 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          {[
            {
              label: 'Conversion Rate',
              value: conversionMetrics ? `${conversionMetrics.conversionRate}%` : (statsLoading ? '...' : '0%'),
              sub: 'Transactions / Total Leads',
              color: 'from-emerald-500 to-teal-500',
            },
            {
              label: 'Leads in Pipeline',
              value: conversionMetrics?.leadsInPipeline ?? (statsLoading ? '...' : 0),
              sub: 'Total active leads',
              color: 'from-sky-500 to-cyan-500',
            },
            {
              label: 'Transactions / Deals',
              value: conversionMetrics?.transactions ?? (statsLoading ? '...' : 0),
              sub: 'Completed transactions',
              color: 'from-amber-500 to-orange-500',
            },
            {
              label: 'Revenue per Lead',
              value: conversionMetrics?.revenuePerLead ?? (statsLoading ? '...' : '₹0'),
              sub: 'Average value per lead',
              color: 'from-violet-500 to-fuchsia-500',
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-xl shadow-slate-200/60"
            >
              <div className={`inline-flex rounded-2xl bg-gradient-to-br ${card.color} px-3 py-2 text-sm font-semibold text-white`}>
                {card.label}
              </div>
              <p className="mt-5 text-3xl font-semibold text-slate-950 sm:text-4xl">
                {card.value}
              </p>
              <p className="mt-1 text-sm text-slate-500">{card.sub}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Data Export */}
      <Card>
        <CardTitle label="Export Data" title="Download your business data for backup or analysis" />
        <div className="mt-5 flex flex-wrap gap-3">
          {[
            { label: 'Export Leads', type: 'leads' },
            { label: 'Export Transactions', type: 'transactions' },
            { label: 'Export Conversations', type: 'conversations' },
          ].map((btn) => (
            <button
              key={btn.type}
              onClick={() => void downloadExport(btn.type)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:shadow-md"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {btn.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Quick workspaces */}
      <Card>
        <CardTitle label="Jump back in" title="Your most-used workspaces" />
        <div className="mt-5 grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
          {[
            { title: 'Google Business', desc: 'Create posts, sync reviews, and publish faster.', href: '/dashboard/gbp', accent: 'from-emerald-400/20 to-cyan-400/10' },
            { title: 'WhatsApp CRM', desc: 'Reply to live chats and move leads through stages.', href: '/dashboard/whatsapp', accent: 'from-sky-400/20 to-indigo-400/10' },
            { title: 'Lead Pipeline', desc: 'Check where follow-up is needed right now.', href: '/dashboard/leads', accent: 'from-amber-400/20 to-orange-400/10' },
            { title: 'Campaigns', desc: 'Launch broadcasts and review delivery results.', href: '/dashboard/campaigns', accent: 'from-fuchsia-400/20 to-violet-400/10' },
          ].map((item) => (
            <button
              key={item.title}
              onClick={() => router.push(item.href)}
              className={`group rounded-[24px] border border-slate-200 bg-gradient-to-br ${item.accent} p-5 text-left transition hover:-translate-y-0.5 hover:border-slate-300`}
            >
              <p className="text-lg font-semibold text-slate-950">{item.title}</p>
              <p className="mt-2 text-sm text-slate-600">{item.desc}</p>
              <span className="mt-4 inline-flex items-center gap-1 rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold text-white transition group-hover:bg-slate-800">
                Open workspace
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </span>
            </button>
          ))}
        </div>
      </Card>

      {/* Lead pipeline */}
      {stats && totalPipeline > 0 && (
        <Card>
          <CardTitle label="Lead pipeline" title="CRM lead distribution" />
          <div className="mt-5 flex h-5 overflow-hidden rounded-full bg-slate-100">
            {CRM_STATUS_ORDER.map((status) => {
              const count = stats.leadsByStatus?.[status] || 0;
              if (!count) return null;
              return (
                <div
                  key={status}
                  className={`${CRM_STATUS_META[status].dot} transition-all hover:opacity-80`}
                  style={{ width: `${(count / totalPipeline) * 100}%` }}
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
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:bg-white hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${CRM_STATUS_META[status].dot}`} />
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {CRM_STATUS_META[status].shortLabel}
                  </span>
                </div>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{stats.leadsByStatus?.[status] || 0}</p>
                <p className="mt-1 text-sm text-slate-500">{CRM_STATUS_META[status].label}</p>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Recent activity */}
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle label="Recent activity" title="WhatsApp and lead updates" />
          <button
            onClick={() => router.push('/dashboard/whatsapp')}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 lg:self-start"
          >
            Open inbox
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div className="rounded-[26px] border border-slate-100 bg-slate-50 p-5">
            <h3 className="text-sm font-semibold text-slate-900">Recent conversations</h3>
            <div className="mt-4 space-y-3">
              {stats?.recentConversations?.length ? (
                stats.recentConversations.map((c) => (
                  <div key={c.$id} className="flex items-start gap-3 rounded-2xl border border-white bg-white px-4 py-3 transition hover:shadow-sm">
                    <Avatar name={c.name} phone={c.phone} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate font-semibold text-slate-900">{c.name || 'WhatsApp contact'}</p>
                        <span className="shrink-0 text-xs text-slate-400">{ago(c.$createdAt || c.createdAt)}</span>
                      </div>
                      <p className="truncate text-sm text-slate-500">{c.message || '-'}</p>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState title="No conversations yet" description="WhatsApp conversations will appear here automatically." />
              )}
            </div>
          </div>
          <div className="rounded-[26px] border border-slate-100 bg-slate-50 p-5">
            <h3 className="text-sm font-semibold text-slate-900">Recent leads</h3>
            <div className="mt-4 space-y-3">
              {stats?.recentLeads?.length ? (
                stats.recentLeads.map((lead) => (
                  <div key={lead.$id} className="flex items-start gap-3 rounded-2xl border border-white bg-white px-4 py-3 transition hover:shadow-sm">
                    <Avatar name={lead.name} phone={lead.phone} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate font-semibold text-slate-900">{lead.name || 'WhatsApp contact'}</p>
                        {lead.status && (
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${CRM_STATUS_META[lead.status].badge}`}>
                            {CRM_STATUS_META[lead.status].shortLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">{ago(lead.$createdAt || lead.createdAt)}</p>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState title="No leads yet" description="Leads will appear here automatically from WhatsApp." />
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Log missed call modal */}
      {showDashboardMissedCall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm" onClick={() => setShowDashboardMissedCall(false)}>
          <div className="mx-4 w-full max-w-md rounded-[32px] border border-slate-200 bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-semibold text-slate-950">Log Missed Call</h2>
            <p className="mt-1 text-sm text-slate-500">Enter the caller's details and we'll send a WhatsApp follow-up.</p>
            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone number *</label>
                <input value={dashMissedForm.phone} onChange={(e) => setDashMissedForm({ ...dashMissedForm, phone: e.target.value })} placeholder="919876543210"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Caller name (optional)</label>
                <input value={dashMissedForm.name} onChange={(e) => setDashMissedForm({ ...dashMissedForm, name: e.target.value })} placeholder="Customer name"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowDashboardMissedCall(false)}
                  className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={() => void handleDashboardMissedCall()} disabled={dashMissedSaving}
                  className="flex-1 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                  {dashMissedSaving ? 'Logging...' : 'Log & Follow Up'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
