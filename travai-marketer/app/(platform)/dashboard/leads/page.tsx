'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/appwrite-client';

const POLL_MS = 15_000;
const STATUS_OPTIONS = ['new', 'contacted', 'converted', 'closed'] as const;
type LeadStatus = (typeof STATUS_OPTIONS)[number];

interface Lead {
  $id: string;
  phone: string;
  name?: string;
  email?: string;
  source?: string;
  status: LeadStatus;
  notes?: string;
  lastContactedAt?: string;
  createdAt?: string;
  $createdAt?: string;
}

const STATUS_CONFIG: Record<LeadStatus, { label: string; dot: string; badge: string; row: string }> = {
  new:       { label: 'New',       dot: 'bg-blue-500',    badge: 'bg-blue-100 text-blue-700',     row: '' },
  contacted: { label: 'Contacted', dot: 'bg-amber-500',   badge: 'bg-amber-100 text-amber-700',   row: '' },
  converted: { label: 'Converted', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', row: 'bg-emerald-50' },
  closed:    { label: 'Closed',    dot: 'bg-gray-400',    badge: 'bg-gray-100 text-gray-500',     row: 'opacity-60' },
};

function ago(iso?: string) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function initials(name?: string, phone?: string) {
  if (name) return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
  return (phone || '?').slice(-2);
}

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<LeadStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [expandedNotes, setExpandedNotes] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; firstError?: string | null } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getCurrentUser().then(u => { if (!u) router.push('/login'); });
  }, [router]);

  const fetchLeads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (filter !== 'all') params.set('status', filter);
      const res = await fetch(`/api/leads?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setFetchError(data?.error || `HTTP ${res.status}`);
      } else {
        setFetchError(null);
        setLeads(data.leads || []);
        setTotal(data.total || 0);
      }
      setLastRefresh(new Date());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchLeads();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchLeads(true), POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchLeads]);

  async function syncFromWhatsApp() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/leads/backfill', { method: 'POST' });
      const data = await res.json();
      setSyncResult({ created: data.created || 0, updated: data.updated || 0, firstError: data.firstError });
      await fetchLeads();
    } catch (err) {
      setSyncResult({ created: 0, updated: 0, firstError: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setSyncing(false);
    }
  }

  async function updateStatus(id: string, status: LeadStatus) {
    setUpdating(id);
    try {
      await fetch(`/api/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setLeads(prev => prev.map(l => l.$id === id ? { ...l, status } : l));
    } finally {
      setUpdating(null);
    }
  }

  const counts = STATUS_OPTIONS.reduce(
    (acc, s) => ({ ...acc, [s]: leads.filter(l => l.status === s).length }),
    {} as Record<LeadStatus, number>
  );

  const filtered = leads.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (l.name || '').toLowerCase().includes(q) ||
      (l.phone || '').includes(q) ||
      (l.email || '').toLowerCase().includes(q) ||
      (l.notes || '').toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Leads CRM</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {total} lead{total !== 1 ? 's' : ''}
              {lastRefresh && ` · updated ${lastRefresh.toLocaleTimeString('en-IN', { timeStyle: 'short' })}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {syncResult && (
              <span className={`text-xs font-medium px-3 py-1.5 rounded-full border ${
                syncResult.firstError
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-emerald-50 text-emerald-600 border-emerald-200'
              }`}>
                {syncResult.firstError
                  ? `Error: ${syncResult.firstError.slice(0, 80)}`
                  : `✓ ${syncResult.created} new · ${syncResult.updated} updated`
                }
              </span>
            )}
            <button
              onClick={syncFromWhatsApp}
              disabled={syncing}
              className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-60 flex items-center gap-2"
            >
              {syncing ? (
                <>
                  <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                  Syncing…
                </>
              ) : (
                'Sync from WhatsApp'
              )}
            </button>
            <button
              onClick={() => fetchLeads()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Stat chips */}
        <div className="grid grid-cols-4 gap-3 mt-5">
          {STATUS_OPTIONS.map(s => {
            const cfg = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => setFilter(filter === s ? 'all' : s)}
                className={`rounded-xl p-3 text-left transition-all border-2 ${
                  filter === s ? 'border-indigo-400 shadow-sm' : 'border-transparent bg-white hover:border-gray-200'
                }`}
                style={{ background: filter === s ? '#eef2ff' : 'white' }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                  <span className="text-xs text-gray-500 font-medium">{cfg.label}</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{counts[s]}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-6">
        {/* Fetch error banner */}
        {fetchError && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-start gap-2">
            <span className="font-semibold flex-shrink-0">Appwrite error:</span>
            <span className="font-mono break-all">{fetchError}</span>
            <a href="/api/leads/debug" target="_blank" rel="noreferrer" className="ml-auto flex-shrink-0 underline text-red-600 hover:text-red-800 text-xs">
              Run diagnostic →
            </a>
          </div>
        )}
        {/* Search + filter */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, notes..."
            className="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <div className="flex gap-1.5 flex-wrap">
            {(['all', ...STATUS_OPTIONS] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  filter === s
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-indigo-300'
                }`}
              >
                {s === 'all' ? 'All' : STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>
        </div>

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
            <p className="text-4xl mb-3">🎯</p>
            <p className="font-semibold text-gray-700 text-lg">No leads yet</p>
            <p className="text-sm text-gray-400 mt-1">
              When customers message on WhatsApp, they appear here automatically.
            </p>
            <button
              onClick={syncFromWhatsApp}
              disabled={syncing}
              className="mt-4 px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-60"
            >
              {syncing ? 'Syncing…' : 'Sync existing WhatsApp contacts'}
            </button>
          </div>
        ) : (
          /* Desktop table */
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm hidden md:table">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80">
                  <th className="text-left px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide w-8">#</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Customer</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Phone</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Notes</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">When</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead, idx) => {
                  const cfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new;
                  const notesOpen = expandedNotes === lead.$id;
                  return (
                    <>
                      <tr
                        key={lead.$id}
                        className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors ${cfg.row}`}
                      >
                        <td className="px-5 py-3.5 text-gray-400 text-xs font-mono">{idx + 1}</td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {initials(lead.name, lead.phone)}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900">{lead.name || <span className="text-gray-400 font-normal">Unknown</span>}</p>
                              {lead.email && <p className="text-xs text-gray-400 truncate max-w-[180px]">{lead.email}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <a
                            href={`https://wa.me/${lead.phone}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
                          >
                            {lead.phone}
                          </a>
                        </td>
                        <td className="px-4 py-3.5 max-w-xs">
                          {lead.notes ? (
                            <button
                              onClick={() => setExpandedNotes(notesOpen ? null : lead.$id)}
                              className="text-xs text-gray-600 text-left hover:text-gray-900 transition-colors"
                            >
                              <span className={notesOpen ? '' : 'line-clamp-2'}>{lead.notes}</span>
                              {lead.notes.length > 80 && (
                                <span className="text-indigo-500 ml-1">{notesOpen ? 'less' : 'more'}</span>
                              )}
                            </button>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-gray-500 whitespace-nowrap">
                          {ago(lead.lastContactedAt || lead.createdAt || lead.$createdAt)}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            {/* Quick-action buttons */}
                            {lead.status === 'new' && (
                              <button
                                onClick={() => updateStatus(lead.$id, 'contacted')}
                                disabled={updating === lead.$id}
                                className="text-xs px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 font-medium transition-colors disabled:opacity-50"
                              >
                                Contacted
                              </button>
                            )}
                            {lead.status === 'contacted' && (
                              <button
                                onClick={() => updateStatus(lead.$id, 'converted')}
                                disabled={updating === lead.$id}
                                className="text-xs px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 font-medium transition-colors disabled:opacity-50"
                              >
                                Converted
                              </button>
                            )}
                            <select
                              value={lead.status}
                              onChange={e => updateStatus(lead.$id, e.target.value as LeadStatus)}
                              disabled={updating === lead.$id}
                              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
                            >
                              {STATUS_OPTIONS.map(s => (
                                <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                      </tr>
                    </>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-gray-100">
              {filtered.map(lead => {
                const cfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new;
                return (
                  <div key={lead.$id} className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                        {initials(lead.name, lead.phone)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-gray-900 truncate">{lead.name || 'Unknown'}</p>
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </span>
                        </div>
                        <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 font-mono hover:underline">
                          {lead.phone}
                        </a>
                        {lead.notes && <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{lead.notes}</p>}
                        <div className="flex items-center gap-2 mt-2.5">
                          <select
                            value={lead.status}
                            onChange={e => updateStatus(lead.$id, e.target.value as LeadStatus)}
                            disabled={updating === lead.$id}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none flex-1"
                          >
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
                          </select>
                          <span className="text-xs text-gray-400">{ago(lead.lastContactedAt || lead.createdAt || lead.$createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
