'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/appwrite-client';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';

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

const STATUS_VARIANT: Record<CampaignStatus, 'default' | 'warning' | 'success' | 'danger' | 'info' | 'purple'> = {
  draft: 'default',
  scheduled: 'info',
  sending: 'warning',
  sent: 'success',
  partial: 'warning',
  failed: 'danger',
};

const SEGMENT_LABELS: Record<string, string> = {
  all: 'All Customers',
  'high-value': 'High Value (Rs5,000+)',
  inactive: 'Inactive (30+ days)',
  service: 'By Service',
};

function formatDate(ts?: string | null) {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function CampaignsPage() {
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      // ignore
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    getCurrentUser().then((u) => { if (!u) { router.push('/login'); return; } setCurrentUserId((u as { $id?: string }).$id || ''); });
    queueMicrotask(() => void loadCampaigns());
  }, [router, loadCampaigns]);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.message.trim()) return;
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        teamId: TEAM_ID, title: form.title.trim(), message: form.message.trim(),
        segment: form.segment, type: 'promotional', createdBy: currentUserId || 'dashboard-user',
      };
      if (form.scheduledAt) body.scheduledAt = new Date(form.scheduledAt).toISOString();
      const res = await fetch('/api/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      setShowCreate(false);
      setForm({ title: '', message: '', segment: 'all', scheduledAt: '' });
      await loadCampaigns();
    } catch (e) {
      console.error(e);
    } finally { setCreating(false); }
  };

  const handleSend = async (campaign: Campaign) => {
    setSendingId(campaign.$id);
    try {
      const res = await fetch('/api/campaigns/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaign.$id, teamId: TEAM_ID }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      await loadCampaigns();
    } catch (e) {
      console.error(e);
    } finally { setSendingId(null); }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Failed to delete');
      await loadCampaigns();
    } catch (e) {
      console.error(e);
    } finally { setDeletingId(null); }
  };

  return (
    <div className="min-h-full space-y-6 p-4 sm:p-6 xl:p-8">
      <Card>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-600">Campaign Engine</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">WhatsApp campaigns</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Draft, schedule, and send outreach campaigns with delivery tracking.
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 lg:w-auto">
            <Button variant="secondary" size="sm" onClick={loadCampaigns}>Refresh</Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>+ New Campaign</Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <LoadingSpinner text="Loading campaigns..." />
      ) : campaigns.length === 0 ? (
        <Card>
          <EmptyState title="No campaigns yet" description="Create your first campaign to reach customers on WhatsApp."
            action={{ label: 'Create Campaign', onClick: () => setShowCreate(true) }} />
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <div key={c.$id} className="rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-lg shadow-slate-200/40 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{c.title}</h3>
                    <Badge variant={STATUS_VARIANT[c.status] || 'default'} size="sm">{c.status}</Badge>
                    <Badge variant="default" size="sm">{SEGMENT_LABELS[c.segment] || c.segment}</Badge>
                  </div>
                  <p className="mb-3 line-clamp-2 text-sm text-slate-500">{c.message}</p>

                  {(c.totalSent || 0) > 0 && (
                    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>Sent: <strong className="text-slate-800">{c.totalSent ?? 0}</strong></span>
                      <span>Delivered: <strong className="text-slate-800">{c.totalDelivered ?? 0}</strong></span>
                      <span>Read: <strong className="text-slate-800">{c.totalRead ?? 0}</strong></span>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    {c.scheduledAt && <span>Scheduled: {formatDate(c.scheduledAt)}</span>}
                    {c.sentAt && <span>Sent: {formatDate(c.sentAt)}</span>}
                    {!c.sentAt && !c.scheduledAt && <span>Created: {formatDate(c.$createdAt || c.createdAt)}</span>}
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                  {c.status !== 'sent' && c.status !== 'sending' && (
                    <Button variant="primary" size="sm" onClick={() => handleSend(c)} loading={sendingId === c.$id}>
                      Send Now
                    </Button>
                  )}
                  <Button variant="danger" size="sm" onClick={() => handleDelete(c.$id)}
                    disabled={deletingId === c.$id || c.status === 'sending'} loading={deletingId === c.$id}>
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="New Campaign" onClose={() => setShowCreate(false)} size="lg">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Campaign Title *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. June Summer Deals"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Message *</label>
              <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={5} maxLength={1000}
                placeholder="Hi! Exciting travel deals are waiting for you this summer..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-100" />
              <p className="mt-1 text-xs text-slate-400">{form.message.length}/1000</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Target Segment</label>
              <select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100">
                <option value="all">All Customers</option>
                <option value="high-value">High Value (spent Rs5,000+)</option>
                <option value="inactive">Inactive (no contact in 30+ days)</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Schedule (optional)</label>
              <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-100" />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={() => setShowCreate(false)} className="flex-1">Cancel</Button>
              <Button onClick={handleCreate} loading={creating} className="flex-1">Create Campaign</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
