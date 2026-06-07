'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/appwrite-client';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'partial';

interface Campaign {
  $id: string;
  title: string;
  message: string;
  segment: string;
  status: CampaignStatus;
  scheduledAt?: string | null;
  sentAt?: string | null;
  totalSent?: number;
  totalDelivered?: number;
  totalRead?: number;
  $createdAt?: string;
  createdAt?: string;
}

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-100 text-blue-700',
  sending: 'bg-yellow-100 text-yellow-700',
  sent: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-orange-100 text-orange-700',
  failed: 'bg-red-100 text-red-700',
};

const SEGMENT_LABELS: Record<string, string> = {
  all: 'All Customers',
  'high-value': 'High Value (Rs5,000+)',
  inactive: 'Inactive (30+ days)',
  service: 'By Service',
};

function formatDate(ts?: string | null) {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className={`fixed left-4 right-4 top-4 z-50 rounded-lg px-4 py-3 text-sm text-white shadow-lg sm:left-auto sm:right-4 ${
        type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
      }`}
    >
      {msg}
    </div>
  );
}

export default function CampaignsPage() {
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type });

  const [form, setForm] = useState({ title: '', message: '', segment: 'all', scheduledAt: '' });
  const [creating, setCreating] = useState(false);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns?teamId=${TEAM_ID}&limit=50&offset=0`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns || data.documents || []);
      }
    } catch {
      // ignore refresh errors so the current list stays visible
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (!u) {
        router.push('/login');
        return;
      }
      setCurrentUserId((u as { $id?: string }).$id || '');
    });
    queueMicrotask(() => {
      void loadCampaigns();
    });
  }, [router, loadCampaigns]);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.message.trim()) {
      showToast('Title and message are required', 'error');
      return;
    }
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        teamId: TEAM_ID,
        title: form.title.trim(),
        message: form.message.trim(),
        segment: form.segment,
        type: 'promotional',
        createdBy: currentUserId || 'dashboard-user',
      };
      if (form.scheduledAt) body.scheduledAt = new Date(form.scheduledAt).toISOString();
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      showToast('Campaign created');
      setShowCreate(false);
      setForm({ title: '', message: '', segment: 'all', scheduledAt: '' });
      await loadCampaigns();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to create campaign', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleSend = async (campaign: Campaign) => {
    if (!confirm(`Send "${campaign.title}" to ${SEGMENT_LABELS[campaign.segment] || campaign.segment}?`)) return;
    setSendingId(campaign.$id);
    try {
      const res = await fetch('/api/campaigns/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaign.$id, teamId: TEAM_ID }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      showToast(`Campaign sent to ${data.totalSent || 0} customers`);
      await loadCampaigns();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to send campaign', 'error');
    } finally {
      setSendingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this campaign?')) return;
    setDeletingId(id);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Failed to delete');
      showToast('Campaign deleted');
      await loadCampaigns();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to delete', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-full px-4 py-4 sm:px-6 sm:py-6 xl:px-8">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <div className="rounded-[32px] border border-slate-200 bg-white/90 p-5 shadow-xl shadow-slate-200/60 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-indigo-600">Campaign Engine</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">Broadcast WhatsApp campaigns</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Draft, schedule, and send polished outreach campaigns without losing visibility into delivery progress.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap lg:w-auto">
            <button
              onClick={loadCampaigns}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              + New Campaign
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="rounded-[28px] border border-slate-200 bg-white/90 p-8 text-center shadow-lg shadow-slate-200/50 sm:p-12">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-indigo-500">Campaigns</p>
            <h3 className="mb-1 text-sm font-semibold text-gray-900">No campaigns yet</h3>
            <p className="mb-4 text-xs text-gray-500">Create your first campaign to reach your customers on WhatsApp.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Create Campaign
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => (
              <div
                key={c.$id}
                className="rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-lg shadow-slate-200/40 sm:p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">{c.title}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status] || STATUS_STYLES.draft}`}>
                        {c.status}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {SEGMENT_LABELS[c.segment] || c.segment}
                      </span>
                    </div>
                    <p className="mb-3 line-clamp-2 text-xs text-gray-500">{c.message}</p>

                    {(c.totalSent || 0) > 0 && (
                      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-xs text-gray-500">Sent: <strong className="text-gray-800">{c.totalSent ?? 0}</strong></span>
                        <span className="text-xs text-gray-500">Delivered: <strong className="text-gray-800">{c.totalDelivered ?? 0}</strong></span>
                        <span className="text-xs text-gray-500">Read: <strong className="text-gray-800">{c.totalRead ?? 0}</strong></span>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                      {c.scheduledAt && <span>Scheduled: {formatDate(c.scheduledAt)}</span>}
                      {c.sentAt && <span>Sent: {formatDate(c.sentAt)}</span>}
                      {!c.sentAt && !c.scheduledAt && <span>Created: {formatDate(c.$createdAt || c.createdAt)}</span>}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                    {c.status !== 'sent' && c.status !== 'sending' && (
                      <button
                        onClick={() => handleSend(c)}
                        disabled={sendingId === c.$id}
                        className="rounded-2xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {sendingId === c.$id ? 'Sending...' : 'Send Now'}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(c.$id)}
                      disabled={deletingId === c.$id || c.status === 'sending'}
                      className="rounded-2xl border border-red-200 px-4 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-40"
                    >
                      {deletingId === c.$id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 p-5">
              <h2 className="font-bold text-gray-900">New Campaign</h2>
              <button onClick={() => setShowCreate(false)} className="text-xl text-gray-400 hover:text-gray-600">x</button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Campaign Title *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. June Summer Deals"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Message *</label>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  rows={5}
                  maxLength={1000}
                  placeholder="Hi! Exciting travel deals are waiting for you this summer. Plan your dream holiday with Traventions - reply to know more!"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-xs text-gray-400">{form.message.length}/1000 characters</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Target Segment</label>
                <select
                  value={form.segment}
                  onChange={(e) => setForm({ ...form, segment: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All Customers</option>
                  <option value="high-value">High Value (spent Rs5,000+)</option>
                  <option value="inactive">Inactive (no contact in 30+ days)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Schedule (optional - leave blank to save as draft)</label>
                <input
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-gray-200 p-5 sm:flex-row">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
