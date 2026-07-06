'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/appwrite-client';
import {
  CRM_STATUS_META,
  CRM_STATUS_ORDER,
  buildStatusCounts,
  coerceLeadStatus,
  type CrmLeadStatus,
} from '@/lib/crm';
import { Avatar } from '@/components/ui/avatar';
import { StatusBadge } from '@/components/ui/status-badge';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { showToast } from '@/components/ui/toast';
import { humanizeMessagePreview } from '@/lib/message-preview';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

interface Lead {
  $id: string;
  phone: string;
  name?: string | null;
  email?: string | null;
  source?: string;
  status: CrmLeadStatus;
  notes?: string | null;
  lastContactedAt?: string;
  createdAt?: string;
  $createdAt?: string;
}

interface ThreadMessage {
  $id: string;
  phone: string;
  type: 'incoming' | 'outgoing';
  messageType?: string;
  text?: string | null;
  status?: string;
  timestamp?: string;
  createdAt?: string;
}

interface ThreadResponse {
  phone: string;
  name: string;
  email?: string | null;
  crmStatus: CrmLeadStatus;
  notes?: string | null;
  messages: ThreadMessage[];
}

function getLeadDisplayName(lead: Lead) {
  if (lead.name?.trim()) return lead.name.trim();
  if (lead.phone) return lead.phone;
  if (lead.source === 'walk_in') return 'Walk-in lead';
  return 'WhatsApp contact';
}

function renderInlineMarkdown(text: string) {
  const parts: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|https?:\/\/[^\s]+)/g;
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const full = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) parts.push(text.slice(lastIndex, start));
    if (/^https?:\/\//.test(full)) {
      parts.push(<a key={key++} href={full} target="_blank" rel="noopener noreferrer" className="break-all underline">{full}</a>);
    } else if (full.startsWith('**') && full.endsWith('**')) {
      parts.push(<strong key={key++}>{full.slice(2, -2)}</strong>);
    } else if (full.startsWith('*') && full.endsWith('*')) {
      parts.push(<strong key={key++}>{full.slice(1, -1)}</strong>);
    } else if (full.startsWith('_') && full.endsWith('_')) {
      parts.push(<em key={key++}>{full.slice(1, -1)}</em>);
    } else if (full.startsWith('~') && full.endsWith('~')) {
      parts.push(<span key={key++} className="line-through">{full.slice(1, -1)}</span>);
    }
    lastIndex = start + full.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function renderMessage(raw?: string | null) {
  const text = (raw || '').trim();
  if (!text) return <span className="italic opacity-50">empty</span>;
  return (
    <div className="space-y-1.5 whitespace-pre-wrap text-sm leading-relaxed">
      {text.split('\n').map((line, index) => (
        <p key={`${line}-${index}`}>{renderInlineMarkdown(line)}</p>
      ))}
    </div>
  );
}

function formatTime(ts?: string) {
  if (!ts) return '';
  const date = new Date(ts);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function preview(msg: string, type?: string) {
  return humanizeMessagePreview(msg, { messageType: type });
}

function formatAgoLabel(iso?: string) {
  if (!iso) return '-';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CrmLeadStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [expandedNotes, setExpandedNotes] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; firstError?: string | null } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showAddLead, setShowAddLead] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', phone: '', email: '', serviceInterest: '', notes: '' });
  const [addingLead, setAddingLead] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [invoiceLead, setInvoiceLead] = useState<Lead | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ service: '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '' });
  const [sendingInvoice, setSendingInvoice] = useState(false);
  const [viewingThreadPhone, setViewingThreadPhone] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [threadInfo, setThreadInfo] = useState<ThreadResponse | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);

  const [purchaseLead, setPurchaseLead] = useState<Lead | null>(null);
  const [purchases, setPurchases] = useState<Array<{ $id: string; amount: number; service?: string; date?: string; status?: string; customerName?: string | null }>>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [showAddPurchase, setShowAddPurchase] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({ service: '', amount: '', date: new Date().toISOString().slice(0, 10), status: 'completed' });
  const [purchaseSaving, setPurchaseSaving] = useState(false);

  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [editNotesText, setEditNotesText] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  async function saveNotes(id: string, notes: string) {
    setSavingNotes(true);
    try {
      await fetch(`/api/leads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) });
      setLeads((prev) => prev.map((l) => (l.$id === id ? { ...l, notes } : l)));
      setEditingNotes(null);
      showToast({ message: 'Notes saved', type: 'success' });
    } catch { showToast({ message: 'Failed to save notes', type: 'error' }); }
    finally { setSavingNotes(false); }
  }

  const [showLogMissedCall, setShowLogMissedCall] = useState(false);
  const [missedCallForm, setMissedCallForm] = useState({ phone: '', name: '' });
  const [missedCallSaving, setMissedCallSaving] = useState(false);

  useEffect(() => {
    getCurrentUser().then((user) => { if (!user) router.push('/login'); });
  }, [router]);

  const fetchLeads = useCallback(async (silent = false, options?: { refreshStatuses?: boolean }) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200', teamId: TEAM_ID });
      if (options?.refreshStatuses) params.set('refreshStatuses', '1');
      const response = await fetch(`/api/leads?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        setFetchError(data?.error || `HTTP ${response.status}`);
      } else {
        setFetchError(null);
        setLeads((data.leads || []).map((lead: Lead) => ({ ...lead, status: coerceLeadStatus(lead.status) })));
        setTotal(data.total || 0);
      }
      setLastRefresh(new Date());
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'Network error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(() => void fetchLeads(false, { refreshStatuses: false })); }, [fetchLeads]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (search) {
        const q = search.toLowerCase();
        if (!String(lead.name || '').toLowerCase().includes(q) &&
            !String(lead.email || '').toLowerCase().includes(q) &&
            !String(lead.phone || '').includes(q) &&
            !String(lead.notes || '').toLowerCase().includes(q)) return false;
      }
      if (filter === 'all') return true;
      return lead.status === filter;
    });
  }, [filter, leads, search]);

  const counts = useMemo(() => buildStatusCounts(leads), [leads]);

  async function syncFromWhatsApp() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const response = await fetch('/api/leads/backfill', { method: 'POST' });
      const data = await response.json();
      setSyncResult({ created: data.created || 0, updated: data.updated || 0, firstError: data.firstError });
      await fetchLeads(false, { refreshStatuses: false });
    } catch (error) {
      setSyncResult({ created: 0, updated: 0, firstError: error instanceof Error ? error.message : 'Network error' });
    } finally { setSyncing(false); }
  }

  async function deleteLead(id: string) {
    if (!window.confirm('Are you sure you want to delete this lead? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await fetch(`/api/leads/${id}`, { method: 'DELETE' });
      setLeads((prev) => prev.filter((l) => l.$id !== id));
      setTotal((prev) => prev - 1);
      showToast({ message: 'Lead deleted', type: 'success' });
    } finally { setDeleting(null); }
  }

  async function updateStatus(id: string, status: CrmLeadStatus) {
    setUpdating(id);
    try {
      await fetch(`/api/leads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      setLeads((prev) => prev.map((l) => (l.$id === id ? { ...l, status } : l)));
    } finally { setUpdating(null); }
  }

  async function handleAddLead() {
    setAddError(null);
    const phone = addForm.phone.replace(/[^\d+]/g, '');
    if (!phone || phone.length < 8) { setAddError('A valid phone number is required.'); return; }
    setAddingLead(true);
    try {
      const response = await fetch('/api/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...addForm, phone, teamId: TEAM_ID, source: 'walk_in' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create lead');
      setShowAddLead(false);
      setAddForm({ name: '', phone: '', email: '', serviceInterest: '', notes: '' });
      showToast({ message: 'Lead created', type: 'success' });
      await fetchLeads();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : 'Failed to create lead');
    } finally { setAddingLead(false); }
  }

  async function handleSendInvoice() {
    if (!invoiceLead) return;
    if (!invoiceForm.service.trim() || !invoiceForm.amount) { showToast({ message: 'Service and amount required', type: 'error' }); return; }
    setSendingInvoice(true);
    try {
      const message = [
        '*TRAVENTIONS INVOICE*', '--------------------',
        `Customer: ${getLeadDisplayName(invoiceLead)}`,
        `Date: ${invoiceForm.date}`,
        `Service: ${invoiceForm.service}`,
        `Amount: INR ${Number(invoiceForm.amount).toLocaleString('en-IN')}`,
        invoiceForm.notes ? `Notes: ${invoiceForm.notes}` : '',
        '--------------------', 'Thank you for choosing Traventions.',
      ].filter(Boolean).join('\n');
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: invoiceLead.phone, message, teamId: TEAM_ID }),
      });
      if (!response.ok) throw new Error('Failed to send invoice');
      setInvoiceLead(null);
      setInvoiceForm({ service: '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '' });
      showToast({ message: `Invoice sent to ${invoiceLead.name || invoiceLead.phone}`, type: 'success' });
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : 'Failed to send', type: 'error' });
    } finally { setSendingInvoice(false); }
  }

  async function loadThread(phone: string) {
    setViewingThreadPhone(phone);
    setThreadLoading(true);
    try {
      const response = await fetch(
        `/api/whatsapp/conversations?teamId=${encodeURIComponent(TEAM_ID)}&phone=${encodeURIComponent(phone)}&_ts=${Date.now()}`,
        { cache: 'no-store' }
      );
      const data = (await response.json()) as ThreadResponse;
      setThread(data.messages || []);
      setThreadInfo(data);
    } catch {
      setThread([]);
      setThreadInfo(null);
      showToast({ message: 'Failed to load conversation', type: 'error' });
    } finally {
      setThreadLoading(false);
    }
  }

  async function loadPurchases(phone: string) {
    setPurchasesLoading(true);
    try {
      const res = await fetch(`/api/transactions?teamId=${encodeURIComponent(TEAM_ID)}&limit=50`);
      const data = await res.json();
      const all = (data.documents || []) as Array<{ $id: string; amount: number; service?: string; date?: string; status?: string; customerName?: string | null; phone?: string }>;
      setPurchases(all.filter(tx => tx.phone?.includes(phone.replace(/[^\d]/g, '')) || tx.customerName?.toLowerCase().includes(phone.toLowerCase())));
    } catch { setPurchases([]); }
    finally { setPurchasesLoading(false); }
  }

  async function handleAddPurchase() {
    if (!purchaseLead || !purchaseForm.amount) { showToast({ message: 'Amount is required', type: 'error' }); return; }
    setPurchaseSaving(true);
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId: TEAM_ID, customerName: purchaseLead.name || getLeadDisplayName(purchaseLead),
          phone: purchaseLead.phone, service: purchaseForm.service,
          amount: Number(purchaseForm.amount), date: purchaseForm.date, status: purchaseForm.status,
        }),
      });
      if (!res.ok) throw new Error('Failed to save purchase');
      showToast({ message: 'Purchase recorded', type: 'success' });
      setShowAddPurchase(false);
      setPurchaseForm({ service: '', amount: '', date: new Date().toISOString().slice(0, 10), status: 'completed' });
      await loadPurchases(purchaseLead.phone);
    } catch (e) { showToast({ message: e instanceof Error ? e.message : 'Failed', type: 'error' }); }
    finally { setPurchaseSaving(false); }
  }

  async function handleLogMissedCall() {
    const phone = missedCallForm.phone.replace(/[^\d+]/g, '');
    if (!phone || phone.length < 8) { showToast({ message: 'Valid phone number required', type: 'error' }); return; }
    setMissedCallSaving(true);
    try {
      const res = await fetch('/api/calls/missed', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name: missedCallForm.name || undefined, teamId: TEAM_ID }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      showToast({ message: 'Missed call logged — WhatsApp follow-up sent', type: 'success' });
      setShowLogMissedCall(false);
      setMissedCallForm({ phone: '', name: '' });
      await fetchLeads();
    } catch (e) { showToast({ message: e instanceof Error ? e.message : 'Failed', type: 'error' }); }
    finally { setMissedCallSaving(false); }
  }

  return (
    <>
      <div className="min-h-full space-y-5 p-4 sm:p-6 xl:p-8">
        <Card>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Lead CRM</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl xl:text-4xl">Sales pipeline</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-500">
                {total} leads · last refresh {lastRefresh ? lastRefresh.toLocaleTimeString('en-IN', { timeStyle: 'short' }) : '-'}
              </p>
            </div>

            <div className="flex w-full flex-wrap gap-2 xl:w-auto xl:justify-end">
              {syncResult && (
                <span className={`rounded-full px-3 py-2 text-xs font-semibold ${syncResult.firstError ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {syncResult.firstError ? `Sync issue` : `Synced ${syncResult.created} new / ${syncResult.updated} updated`}
                </span>
              )}
              <Button variant="secondary" size="sm" onClick={() => setShowLogMissedCall(true)}>Log Missed Call</Button>
              <Button variant="secondary" size="sm" onClick={syncFromWhatsApp} loading={syncing}>Sync from WhatsApp</Button>
              <Button size="sm" onClick={() => setShowAddLead(true)}>Add walk-in lead</Button>
              <Button variant="secondary" size="sm" onClick={() => fetchLeads(false, { refreshStatuses: true })}>Refresh</Button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {CRM_STATUS_ORDER.map((status) => {
              const meta = CRM_STATUS_META[status];
              const isActive = filter === status;
              return (
                <button key={status} onClick={() => setFilter(filter === status ? 'all' : status)}
                  className={`rounded-[26px] border p-4 text-left transition ${isActive ? 'border-slate-900 bg-slate-900 text-white shadow-lg' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
                    <span className={`text-xs font-semibold uppercase tracking-[0.18em] ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>{meta.shortLabel}</span>
                  </div>
                  <p className={`mt-3 text-3xl font-semibold ${isActive ? 'text-white' : 'text-slate-900'}`}>{counts[status] || 0}</p>
                  <p className={`mt-1 text-sm ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>{meta.label}</p>
                </button>
              );
            })}
          </div>
        </Card>

        {fetchError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{fetchError}</div>
        )}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, email, or note"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100 lg:max-w-xl" />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setFilter('all')}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filter === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>
              All ({leads.length})
            </button>
            {CRM_STATUS_ORDER.map((status) => (
              <button key={status} onClick={() => setFilter(status)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filter === status ? CRM_STATUS_META[status].soft : 'bg-white text-slate-600 hover:bg-slate-100'}`}>
                {CRM_STATUS_META[status].shortLabel} ({counts[status] || 0})
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <LoadingSpinner text="Loading leads..." />
        ) : filteredLeads.length === 0 ? (
          <EmptyState title="No leads found" description="New WhatsApp enquiries and manual walk-ins will appear here automatically."
            action={filter === 'all' ? undefined : { label: 'Clear filter', onClick: () => setFilter('all') }} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {filteredLeads.map((lead) => (
              <div key={lead.$id} className="rounded-[30px] border border-slate-200 bg-white/90 p-5 shadow-lg shadow-slate-200/50">
                <div className="flex items-start gap-4">
                  <Avatar name={lead.name} phone={lead.phone} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-xl font-semibold text-slate-950">{getLeadDisplayName(lead)}</h3>
                          <StatusBadge status={lead.status} />
                        </div>
                        <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noreferrer"
                          className="mt-1 inline-block text-sm font-medium text-emerald-700 hover:underline">{lead.phone}</a>
                        {lead.email && <p className="mt-1 text-sm text-slate-500">{lead.email}</p>}
                      </div>
                      <div className="text-left text-xs text-slate-400 sm:text-right">
                        <p>Last touch {formatAgoLabel(lead.lastContactedAt || lead.createdAt || lead.$createdAt)}</p>
                        <p className="mt-1">Source: {lead.source || 'whatsapp'}</p>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      {editingNotes === lead.$id ? (
                        <div className="flex flex-col gap-2">
                          <textarea value={editNotesText} onChange={(e) => setEditNotesText(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-300"
                            rows={3} autoFocus />
                          <div className="flex gap-2">
                            <button onClick={() => saveNotes(lead.$id, editNotesText)} disabled={savingNotes}
                              className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                              {savingNotes ? 'Saving...' : 'Save'}
                            </button>
                            <button onClick={() => setEditingNotes(null)}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="group flex items-start justify-between gap-2">
                          <div className="flex-1 text-left">
                            {lead.notes ? (
                              <button onClick={() => setExpandedNotes(expandedNotes === lead.$id ? null : lead.$id)} className="text-left">
                                <span className={expandedNotes === lead.$id ? '' : 'line-clamp-3'}>{lead.notes}</span>
                                {lead.notes.length > 120 && (
                                  <span className="ml-1 font-semibold text-emerald-700">
                                    {expandedNotes === lead.$id ? 'show less' : 'show more'}
                                  </span>
                                )}
                              </button>
                            ) : (
                              <span className="text-slate-400">No notes yet</span>
                            )}
                          </div>
                          <button onClick={() => { setEditNotesText(lead.notes || ''); setEditingNotes(lead.$id); }}
                            className="shrink-0 rounded-lg px-2 py-1 text-xs text-slate-400 opacity-0 transition hover:bg-slate-200 group-hover:opacity-100">
                            Edit
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        {lead.status === 'new_lead' && (
                          <button onClick={() => updateStatus(lead.$id, 'normal_conversation')} disabled={updating === lead.$id}
                            className="rounded-full bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-200 disabled:opacity-50">
                            Move to Normal
                          </button>
                        )}
                        {lead.status !== 'converted' && (
                          <button onClick={() => updateStatus(lead.$id, 'converted')} disabled={updating === lead.$id}
                            className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-200 disabled:opacity-50">
                            Mark Converted
                          </button>
                        )}
                        <button onClick={() => loadThread(lead.phone)}
                          className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50">
                          View conversation
                        </button>
                        <button onClick={() => { setInvoiceLead(lead); setInvoiceForm({ service: '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '' }); }}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
                          Send invoice
                        </button>
                        <button onClick={() => { setPurchaseLead(lead); void loadPurchases(lead.phone); }}
                          className="rounded-full bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 ring-1 ring-teal-200 transition hover:bg-teal-100">
                          Purchases
                        </button>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <select value={lead.status} onChange={(e) => updateStatus(lead.$id, e.target.value as CrmLeadStatus)} disabled={updating === lead.$id}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-300 sm:w-auto">
                          {CRM_STATUS_ORDER.map((s) => <option key={s} value={s}>{CRM_STATUS_META[s].label}</option>)}
                        </select>
                        <button onClick={() => deleteLead(lead.$id)} disabled={deleting === lead.$id}
                          className="w-full rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 sm:w-auto">
                          {deleting === lead.$id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add lead modal */}
      {showAddLead && (
        <Modal title="Add walk-in lead" onClose={() => setShowAddLead(false)}>
          <div className="space-y-4">
            {addError && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{addError}</div>}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone number *</label>
              <input value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} placeholder="919876543210"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Name</label>
              <input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Customer name"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <input value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="email@example.com"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Service interest</label>
              <input value={addForm.serviceInterest} onChange={(e) => setAddForm({ ...addForm, serviceInterest: e.target.value })} placeholder="Goa package, honeymoon trip..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes</label>
              <textarea value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} rows={4} placeholder="Any details shared by the traveller..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <Button onClick={handleAddLead} loading={addingLead} className="w-full">Create lead</Button>
          </div>
        </Modal>
      )}

      {/* Invoice modal */}
      {invoiceLead && (
        <Modal title="Send invoice" onClose={() => setInvoiceLead(null)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Service *</label>
              <input value={invoiceForm.service} onChange={(e) => setInvoiceForm({ ...invoiceForm, service: e.target.value })} placeholder="Bali package 4N/5D"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Amount (INR) *</label>
              <input value={invoiceForm.amount} onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} type="number" placeholder="35000"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Date</label>
              <input value={invoiceForm.date} onChange={(e) => setInvoiceForm({ ...invoiceForm, date: e.target.value })} type="date"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes / terms</label>
              <textarea value={invoiceForm.notes} onChange={(e) => setInvoiceForm({ ...invoiceForm, notes: e.target.value })} rows={3} placeholder="Payment due within 7 days..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <Button onClick={handleSendInvoice} loading={sendingInvoice} className="w-full">Send invoice via WhatsApp</Button>
          </div>
        </Modal>
      )}

      {/* Conversation thread modal */}
      {viewingThreadPhone && (
        <Modal title={threadInfo?.name || viewingThreadPhone} onClose={() => setViewingThreadPhone(null)} size="lg">
          <div className="flex flex-col" style={{ maxHeight: '70vh' }}>
            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
              <a href={`https://wa.me/${viewingThreadPhone}`} target="_blank" rel="noreferrer"
                className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                Open in WhatsApp
              </a>
              {threadInfo?.crmStatus && (
                <StatusBadge status={threadInfo.crmStatus} size="sm" />
              )}
              {threadInfo?.email && (
                <span className="text-xs text-slate-400">{threadInfo.email}</span>
              )}
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto">
              {threadLoading ? (
                <LoadingSpinner />
              ) : thread.length === 0 ? (
                <div className="py-16 text-center text-sm text-slate-400">No messages yet.</div>
              ) : (
                thread.map((message) => {
                  const outgoing = message.type === 'outgoing';
                  const messageText = (message.text || '').trim();
                  const isMedia = !messageText || messageText === '[unsupported]' || messageText === '[media]' || ['image','audio','video','document','sticker','location','media'].includes(message.messageType || '');
                  return (
                    <div key={message.$id} className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[92%] rounded-[24px] px-4 py-3 shadow-sm sm:max-w-[82%] xl:max-w-[78%] ${
                        outgoing
                          ? 'rounded-tr-sm bg-emerald-500 text-white'
                          : 'rounded-tl-sm border border-white/80 bg-white text-slate-800'
                      }`}>
                        {isMedia ? (
                          <p className={`text-sm italic ${outgoing ? 'text-emerald-50' : 'text-slate-400'}`}>
                            {preview(message.text || '', message.messageType)}
                          </p>
                        ) : renderMessage(message.text)}
                        <p className={`mt-2 text-right text-[11px] ${outgoing ? 'text-emerald-50/90' : 'text-slate-400'}`}>
                          {formatTime(message.timestamp || message.createdAt)}
                          {outgoing && message.status ? ` · ${message.status}` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Purchases modal */}
      {purchaseLead && (
        <Modal title={`Purchases — ${getLeadDisplayName(purchaseLead)}`} onClose={() => setPurchaseLead(null)} size="lg">
          <div className="flex flex-col gap-4" style={{ maxHeight: '70vh' }}>
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">{purchases.length} transaction{purchases.length !== 1 ? 's' : ''}</p>
              <Button size="sm" onClick={() => setShowAddPurchase(true)}>Add Purchase</Button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto">
              {purchasesLoading ? (
                <LoadingSpinner />
              ) : purchases.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">No purchases recorded yet.</div>
              ) : (
                purchases.map((tx) => (
                  <div key={tx.$id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-lg font-semibold text-slate-950">INR {Number(tx.amount).toLocaleString('en-IN')}</p>
                        {tx.service && <p className="text-sm text-slate-600">{tx.service}</p>}
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        tx.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                        tx.status === 'refunded' ? 'bg-rose-100 text-rose-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{tx.status || 'completed'}</span>
                    </div>
                    {tx.date && <p className="mt-2 text-xs text-slate-400">{new Date(tx.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Add purchase modal */}
      {showAddPurchase && (
        <Modal title="Add Purchase" onClose={() => setShowAddPurchase(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Service</label>
              <input value={purchaseForm.service} onChange={(e) => setPurchaseForm({ ...purchaseForm, service: e.target.value })} placeholder="Goa package, Bali trip..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Amount (INR) *</label>
              <input value={purchaseForm.amount} onChange={(e) => setPurchaseForm({ ...purchaseForm, amount: e.target.value })} type="number" placeholder="35000"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Date</label>
              <input value={purchaseForm.date} onChange={(e) => setPurchaseForm({ ...purchaseForm, date: e.target.value })} type="date"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Status</label>
              <select value={purchaseForm.status} onChange={(e) => setPurchaseForm({ ...purchaseForm, status: e.target.value })}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100">
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="refunded">Refunded</option>
              </select>
            </div>
            <Button onClick={handleAddPurchase} loading={purchaseSaving} className="w-full">Save Purchase</Button>
          </div>
        </Modal>
      )}

      {/* Log missed call modal */}
      {showLogMissedCall && (
        <Modal title="Log Missed Call" onClose={() => setShowLogMissedCall(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone number *</label>
              <input value={missedCallForm.phone} onChange={(e) => setMissedCallForm({ ...missedCallForm, phone: e.target.value })} placeholder="919876543210"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Caller name (optional)</label>
              <input value={missedCallForm.name} onChange={(e) => setMissedCallForm({ ...missedCallForm, name: e.target.value })} placeholder="Customer name"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <Button onClick={handleLogMissedCall} loading={missedCallSaving} className="w-full">Log & Send WhatsApp Follow-Up</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
