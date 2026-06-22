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

function getLeadDisplayName(lead: Lead) {
  if (lead.name?.trim()) return lead.name.trim();
  if (lead.source === 'walk_in') return 'Walk-in lead';
  return 'WhatsApp contact';
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

function initials(name?: string | null, phone?: string) {
  const safeName = String(name || '').trim();
  if (safeName) {
    return safeName
      .split(' ')
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('');
  }
  return phone ? 'WA' : '?';
}

function StatusBadge({ status }: { status: CrmLeadStatus }) {
  const meta = CRM_STATUS_META[coerceLeadStatus(status)];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-50"
          >
            Close
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
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
  useEffect(() => {
    getCurrentUser().then((user) => {
      if (!user) router.push('/login');
    });
  }, [router]);

  const fetchLeads = useCallback(
    async (silent = false, options?: { refreshStatuses?: boolean }) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '200', teamId: TEAM_ID });
        if (options?.refreshStatuses) {
          params.set('refreshStatuses', '1');
        }
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
    },
    []
  );

  useEffect(() => {
    queueMicrotask(() => {
      void fetchLeads(false, { refreshStatuses: false });
    });
    return () => {
      // manual refresh only to keep Appwrite reads low
    };
  }, [fetchLeads]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (search) {
        const query = search.toLowerCase();
        const matches =
          String(lead.name || '').toLowerCase().includes(query) ||
          String(lead.email || '').toLowerCase().includes(query) ||
          String(lead.phone || '').includes(query) ||
          String(lead.notes || '').toLowerCase().includes(query);
        if (!matches) return false;
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
    } finally {
      setSyncing(false);
    }
  }

  async function deleteLead(id: string) {
    if (!confirm('Delete this lead? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await fetch(`/api/leads/${id}`, { method: 'DELETE' });
      setLeads((previous) => previous.filter((lead) => lead.$id !== id));
      setTotal((previous) => previous - 1);
    } finally {
      setDeleting(null);
    }
  }

  async function updateStatus(id: string, status: CrmLeadStatus) {
    setUpdating(id);
    try {
      await fetch(`/api/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setLeads((previous) => previous.map((lead) => (lead.$id === id ? { ...lead, status } : lead)));
    } finally {
      setUpdating(null);
    }
  }

  async function handleAddLead() {
    setAddError(null);
    const phone = addForm.phone.replace(/[^\d+]/g, '');
    if (!phone || phone.length < 8) {
      setAddError('A valid phone number is required.');
      return;
    }

    setAddingLead(true);
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...addForm, phone, teamId: TEAM_ID, source: 'walk_in' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create lead');
      setShowAddLead(false);
      setAddForm({ name: '', phone: '', email: '', serviceInterest: '', notes: '' });
      await fetchLeads();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : 'Failed to create lead');
    } finally {
      setAddingLead(false);
    }
  }

  async function handleSendInvoice() {
    if (!invoiceLead) return;
    if (!invoiceForm.service.trim() || !invoiceForm.amount) {
      alert('Service and amount are required.');
      return;
    }
    setSendingInvoice(true);
    try {
      const message = [
        '*TRAVENTIONS INVOICE*',
        '--------------------',
        `Customer: ${getLeadDisplayName(invoiceLead)}`,
        `Date: ${invoiceForm.date}`,
        `Service: ${invoiceForm.service}`,
        `Amount: INR ${Number(invoiceForm.amount).toLocaleString('en-IN')}`,
        invoiceForm.notes ? `Notes: ${invoiceForm.notes}` : '',
        '--------------------',
        'Thank you for choosing Traventions.',
      ]
        .filter(Boolean)
        .join('\n');

      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: invoiceLead.phone, message, teamId: TEAM_ID }),
      });
      if (!response.ok) throw new Error('Failed to send invoice');
      setInvoiceLead(null);
      setInvoiceForm({ service: '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '' });
      alert(`Invoice sent to ${invoiceLead.name || invoiceLead.phone}`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to send invoice');
    } finally {
      setSendingInvoice(false);
    }
  }

  return (
    <>
      <div className="min-h-full px-4 py-4 sm:px-6 sm:py-6 xl:px-8">
        <div className="rounded-[32px] border border-slate-200 bg-white/85 p-5 shadow-xl shadow-slate-200/60 backdrop-blur sm:p-6 lg:p-7">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-600">Lead CRM</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl xl:text-4xl">Sales pipeline with AI-aware lead stages</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-500">
                WhatsApp leads now move through New Lead, Normal Conversation, Connected, Converted,
                and Closed. Callback requests, contact identity, and manual sales actions all stay in sync.
              </p>
              <p className="mt-2 hidden text-xs text-slate-400">
                {total} leads · last refresh{' '}
                {lastRefresh ? lastRefresh.toLocaleTimeString('en-IN', { timeStyle: 'short' }) : '—'}
              </p>
              <p className="mt-2 hidden text-xs text-slate-400">
                {total} leads · last refresh{' '}
                {lastRefresh ? lastRefresh.toLocaleTimeString('en-IN', { timeStyle: 'short' }) : '-'}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                {total} leads - last refresh{' '}
                {lastRefresh ? lastRefresh.toLocaleTimeString('en-IN', { timeStyle: 'short' }) : '-'}
              </p>
            </div>

            <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:w-auto xl:justify-end">
              {syncResult && (
                <span
                  className={`rounded-full px-3 py-2 text-xs font-semibold ${
                    syncResult.firstError
                      ? 'bg-rose-50 text-rose-700'
                      : 'bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {syncResult.firstError
                    ? `Sync issue: ${syncResult.firstError.slice(0, 80)}`
                    : `Synced ${syncResult.created} new / ${syncResult.updated} updated`}
                </span>
              )}
              <button
                onClick={syncFromWhatsApp}
                disabled={syncing}
                className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
              >
                {syncing ? 'Syncing...' : 'Sync from WhatsApp'}
              </button>
              <button
                onClick={() => setShowAddLead(true)}
                className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Add walk-in lead
              </button>
              <button
                onClick={() => fetchLeads(false, { refreshStatuses: true })}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {CRM_STATUS_ORDER.map((status) => {
              const meta = CRM_STATUS_META[status];
              const isActive = filter === status;
              return (
                <button
                  key={status}
                  onClick={() => setFilter(filter === status ? 'all' : status)}
                  className={`rounded-[26px] border p-4 text-left transition ${
                    isActive ? 'border-slate-900 bg-slate-900 text-white shadow-lg' : 'border-slate-200 bg-slate-50 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
                    <span className={`text-xs font-semibold uppercase tracking-[0.18em] ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>
                      {meta.shortLabel}
                    </span>
                  </div>
                  <p className={`mt-3 text-3xl font-semibold ${isActive ? 'text-white' : 'text-slate-900'}`}>
                    {counts[status] || 0}
                  </p>
                  <p className={`mt-1 text-sm ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>{meta.label}</p>
                </button>
              );
            })}
          </div>
        </div>

        {fetchError && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {fetchError}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, phone, email, or note"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100 lg:max-w-xl"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                filter === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              All
            </button>
            {CRM_STATUS_ORDER.map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  filter === status ? CRM_STATUS_META[status].soft : 'bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                {CRM_STATUS_META[status].label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-emerald-600" />
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="mt-6 rounded-[32px] border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/60 sm:p-12 lg:p-16">
            <h2 className="text-2xl font-semibold text-slate-900">No leads found</h2>
            <p className="mt-2 text-sm text-slate-500">
              New WhatsApp enquiries and manual walk-ins will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            {filteredLeads.map((lead) => (
              <div
                key={lead.$id}
                className="rounded-[30px] border border-slate-200 bg-white/90 p-5 shadow-lg shadow-slate-200/50"
              >
                <div className="flex items-start gap-4">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-[20px] bg-gradient-to-br ${CRM_STATUS_META[lead.status].panel} text-sm font-bold text-white shadow-lg`}>
                    {initials(lead.name, lead.phone)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-xl font-semibold text-slate-950">
                            {getLeadDisplayName(lead)}
                          </h3>
                          <StatusBadge status={lead.status} />
                        </div>
                        <a
                          href={`https://wa.me/${lead.phone}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-sm font-medium text-emerald-700 hover:underline"
                        >
                          {lead.phone}
                        </a>
                        {lead.email && <p className="mt-1 text-sm text-slate-500">{lead.email}</p>}
                      </div>
                      <div className="text-left text-xs text-slate-400 sm:text-right">
                        <p>Last touch {formatAgoLabel(lead.lastContactedAt || lead.createdAt || lead.$createdAt)}</p>
                        <p className="mt-1">Source: {lead.source || 'whatsapp'}</p>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      {lead.notes ? (
                        <button
                          onClick={() => setExpandedNotes(expandedNotes === lead.$id ? null : lead.$id)}
                          className="text-left"
                        >
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

                    <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        {lead.status === 'new_lead' && (
                          <button
                            onClick={() => updateStatus(lead.$id, 'normal_conversation')}
                            disabled={updating === lead.$id}
                            className="rounded-full bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-200 disabled:opacity-50"
                          >
                            Move to Normal
                          </button>
                        )}
                        {lead.status !== 'converted' && (
                          <button
                            onClick={() => updateStatus(lead.$id, 'converted')}
                            disabled={updating === lead.$id}
                            className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-200 disabled:opacity-50"
                          >
                            Mark Converted
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setInvoiceLead(lead);
                            setInvoiceForm({ service: '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '' });
                          }}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          Send invoice
                        </button>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <select
                          value={lead.status}
                          onChange={(event) => updateStatus(lead.$id, event.target.value as CrmLeadStatus)}
                          disabled={updating === lead.$id}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-300 sm:w-auto"
                        >
                          {CRM_STATUS_ORDER.map((status) => (
                            <option key={status} value={status}>
                              {CRM_STATUS_META[status].label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => deleteLead(lead.$id)}
                          disabled={deleting === lead.$id}
                          className="w-full rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 sm:w-auto"
                        >
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

      {showAddLead && (
        <Modal
          title="Add walk-in lead"
          subtitle="Capture an offline or phone enquiry manually and place it into the CRM."
          onClose={() => setShowAddLead(false)}
        >
          <div className="space-y-4">
            {addError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {addError}
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone number *</label>
              <input
                value={addForm.phone}
                onChange={(event) => setAddForm({ ...addForm, phone: event.target.value })}
                placeholder="919876543210"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Name</label>
              <input
                value={addForm.name}
                onChange={(event) => setAddForm({ ...addForm, name: event.target.value })}
                placeholder="Customer name"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <input
                value={addForm.email}
                onChange={(event) => setAddForm({ ...addForm, email: event.target.value })}
                placeholder="email@example.com"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Service interest</label>
              <input
                value={addForm.serviceInterest}
                onChange={(event) => setAddForm({ ...addForm, serviceInterest: event.target.value })}
                placeholder="Goa package, honeymoon trip, visa support..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes</label>
              <textarea
                value={addForm.notes}
                onChange={(event) => setAddForm({ ...addForm, notes: event.target.value })}
                rows={4}
                placeholder="Any details shared by the traveller..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <button
              onClick={handleAddLead}
              disabled={addingLead}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {addingLead ? 'Adding...' : 'Create lead'}
            </button>
          </div>
        </Modal>
      )}

      {invoiceLead && (
        <Modal
          title="Send invoice"
          subtitle={`Share an invoice message directly with ${invoiceLead.name || invoiceLead.phone} on WhatsApp.`}
          onClose={() => setInvoiceLead(null)}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Service *</label>
              <input
                value={invoiceForm.service}
                onChange={(event) => setInvoiceForm({ ...invoiceForm, service: event.target.value })}
                placeholder="Bali package 4N/5D"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Amount *</label>
              <input
                value={invoiceForm.amount}
                onChange={(event) => setInvoiceForm({ ...invoiceForm, amount: event.target.value })}
                type="number"
                placeholder="35000"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Date</label>
              <input
                value={invoiceForm.date}
                onChange={(event) => setInvoiceForm({ ...invoiceForm, date: event.target.value })}
                type="date"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes / terms</label>
              <textarea
                value={invoiceForm.notes}
                onChange={(event) => setInvoiceForm({ ...invoiceForm, notes: event.target.value })}
                rows={3}
                placeholder="Payment due within 7 days..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <button
              onClick={handleSendInvoice}
              disabled={sendingInvoice}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {sendingInvoice ? 'Sending...' : 'Send invoice via WhatsApp'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
