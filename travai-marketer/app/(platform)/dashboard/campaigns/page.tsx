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
  'high-value': 'High Value (₹5K+)',
  inactive: 'Inactive (30+ days)',
  service: 'By Service',
};

function formatDate(ts?: string | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm text-white ${type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
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

  // Create form state
  const [form, setForm] = useState({ title: '', message: '', segment: 'all', scheduledAt: '' });
  const [creating, setCreating] = useState(false);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns?teamId=${TEAM_ID}&limit=50&offset=0`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns || data.documents || []);
      }
    } catch { /* silent */ } finally {
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
        teamId: TEAM_ID, title: form.title.trim(), message: form.message.trim(),
        segment: form.segment, type: 'promotional', createdBy: currentUserId || 'dashboard-user',
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
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Campaigns</h1>
          <p className="text-xs text-gray-500 mt-0.5">Broadcast WhatsApp messages to your customer segments</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadCampaigns} className="px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 border border-gray-200 rounded-lg">
            Refresh
          </button>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
            + New Campaign
          </button>
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-4xl mb-3">📢</p>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">No campaigns yet</h3>
            <p className="text-xs text-gray-500 mb-4">Create your first campaign to reach your customers on WhatsApp.</p>
            <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
              Create Campaign
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => (
              <div key={c.$id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900 text-sm">{c.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[c.status] || STATUS_STYLES.draft}`}>
                        {c.status}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {SEGMENT_LABELS[c.segment] || c.segment}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2 mb-3">{c.message}</p>

                    {/* Stats row */}
                    {(c.totalSent || 0) > 0 && (
                      <div className="flex gap-4 mb-3">
                        <span className="text-xs text-gray-500">Sent: <strong className="text-gray-800">{c.totalSent ?? 0}</strong></span>
                        <span className="text-xs text-gray-500">Delivered: <strong className="text-gray-800">{c.totalDelivered ?? 0}</strong></span>
                        <span className="text-xs text-gray-500">Read: <strong className="text-gray-800">{c.totalRead ?? 0}</strong></span>
                      </div>
                    )}

                    <div className="flex gap-4 text-xs text-gray-400">
                      {c.scheduledAt && <span>Scheduled: {formatDate(c.scheduledAt)}</span>}
                      {c.sentAt && <span>Sent: {formatDate(c.sentAt)}</span>}
                      {!c.sentAt && !c.scheduledAt && <span>Created: {formatDate(c.$createdAt || c.createdAt)}</span>}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 flex-shrink-0">
                    {c.status !== 'sent' && c.status !== 'sending' && (
                      <button
                        onClick={() => handleSend(c)}
                        disabled={sendingId === c.$id}
                        className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {sendingId === c.$id ? 'Sending…' : 'Send Now'}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(c.$id)}
                      disabled={deletingId === c.$id || c.status === 'sending'}
                      className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 disabled:opacity-40"
                    >
                      {deletingId === c.$id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Campaign Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="font-bold text-gray-900">New Campaign</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Title *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. June Summer Deals"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  rows={5}
                  maxLength={1000}
                  placeholder="Hi! Exciting travel deals are waiting for you this summer. Plan your dream holiday with Traventions — reply to know more!"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">{form.message.length}/1000 characters</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Segment</label>
                <select
                  value={form.segment}
                  onChange={(e) => setForm({ ...form, segment: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All Customers</option>
                  <option value="high-value">High Value (spent ₹5,000+)</option>
                  <option value="inactive">Inactive (no contact in 30+ days)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Schedule (optional — leave blank to save as draft)</label>
                <input
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t border-gray-200">
              <button onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
