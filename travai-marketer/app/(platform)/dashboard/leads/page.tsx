'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/appwrite-client';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'system';
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

const STATUS_STYLES: Record<LeadStatus, { badge: string; label: string }> = {
  new:       { badge: 'bg-blue-100 text-blue-700',   label: 'New' },
  contacted: { badge: 'bg-amber-100 text-amber-700',  label: 'Contacted' },
  converted: { badge: 'bg-emerald-100 text-emerald-700', label: 'Converted' },
  closed:    { badge: 'bg-gray-100 text-gray-500',   label: 'Closed' },
};

function formatDate(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function initials(name?: string, phone?: string) {
  if (name) {
    return name
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('');
  }
  return (phone || '?').slice(-2);
}

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<LeadStatus | 'all'>('all');
  const [updating, setUpdating] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (!u) router.push('/login');
    });
  }, [router]);

  const fetchLeads = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({ teamId: TEAM_ID, limit: '100' });
        if (filter !== 'all') params.set('status', filter);
        const res = await fetch(`/api/leads?${params}`);
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.json();
        setLeads(data.leads || []);
        setTotal(data.total || 0);
        setLastRefresh(new Date());
      } catch {
        // keep stale data on silent refresh
      } finally {
        setLoading(false);
      }
    },
    [filter]
  );

  useEffect(() => {
    fetchLeads();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchLeads(true), POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchLeads]);

  async function updateStatus(id: string, status: LeadStatus) {
    setUpdating(id);
    try {
      await fetch(`/api/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setLeads((prev) =>
        prev.map((l) => (l.$id === id ? { ...l, status } : l))
      );
    } finally {
      setUpdating(null);
    }
  }

  const counts = STATUS_OPTIONS.reduce(
    (acc, s) => ({ ...acc, [s]: leads.filter((l) => l.status === s).length }),
    {} as Record<LeadStatus, number>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads CRM</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total} total lead{total !== 1 ? 's' : ''} · auto-refreshes every 15s
            {lastRefresh && (
              <span className="ml-2 text-gray-400">
                · last updated {lastRefresh.toLocaleTimeString('en-IN', { timeStyle: 'short' })}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => fetchLeads()}
          className="self-start sm:self-auto px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {STATUS_OPTIONS.map((s) => {
          const st = STATUS_STYLES[s];
          return (
            <button
              key={s}
              onClick={() => setFilter(filter === s ? 'all' : s)}
              className={`rounded-xl p-4 text-left border-2 transition-colors ${
                filter === s
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-transparent bg-white shadow-sm hover:border-gray-200'
              }`}
            >
              <p className="text-2xl font-bold text-gray-900">{counts[s]}</p>
              <p className="text-xs font-medium text-gray-500 mt-0.5">{st.label}</p>
            </button>
          );
        })}
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap mb-4">
        {(['all', ...STATUS_OPTIONS] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === s
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-indigo-300'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_STYLES[s].label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : leads.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">🎯</p>
          <p className="font-semibold text-gray-700">No leads yet</p>
          <p className="text-sm text-gray-400 mt-1">
            Leads appear here when customers interact on WhatsApp.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 w-10">#</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Customer</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 max-w-xs">Notes</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Last Contact</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {leads.map((lead, idx) => {
                  const st = STATUS_STYLES[lead.status] || STATUS_STYLES.new;
                  return (
                    <tr key={lead.$id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 flex-shrink-0">
                            {initials(lead.name, lead.phone)}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{lead.name || 'Unknown'}</p>
                            {lead.email && (
                              <p className="text-xs text-gray-400 truncate max-w-[160px]">{lead.email}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                        <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noreferrer" className="hover:text-indigo-600">
                          {lead.phone}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs capitalize">{lead.source || 'whatsapp'}</td>
                      <td className="px-4 py-3 max-w-xs">
                        {lead.notes ? (
                          <p className="text-xs text-gray-600 truncate" title={lead.notes}>
                            {lead.notes}
                          </p>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {formatDate(lead.lastContactedAt || lead.createdAt || lead.$createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={lead.status}
                          onChange={(e) => updateStatus(lead.$id, e.target.value as LeadStatus)}
                          disabled={updating === lead.$id}
                          className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300 ${st.badge} ${
                            updating === lead.$id ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_STYLES[s].label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-gray-100">
            {leads.map((lead) => {
              const st = STATUS_STYLES[lead.status] || STATUS_STYLES.new;
              const isOpen = expanded === lead.$id;
              return (
                <div key={lead.$id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 flex-shrink-0">
                        {initials(lead.name, lead.phone)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{lead.name || 'Unknown'}</p>
                        <a
                          href={`https://wa.me/${lead.phone}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-indigo-500 font-mono"
                        >
                          {lead.phone}
                        </a>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.badge}`}>
                        {st.label}
                      </span>
                      <button
                        onClick={() => setExpanded(isOpen ? null : lead.$id)}
                        className="text-gray-400 hover:text-gray-600 p-1"
                      >
                        <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="mt-3 space-y-2 pl-12">
                      {lead.email && (
                        <p className="text-xs text-gray-500">{lead.email}</p>
                      )}
                      {lead.notes && (
                        <p className="text-xs text-gray-600 bg-gray-50 rounded p-2">{lead.notes}</p>
                      )}
                      <p className="text-xs text-gray-400">
                        {formatDate(lead.lastContactedAt || lead.createdAt || lead.$createdAt)}
                      </p>
                      <select
                        value={lead.status}
                        onChange={(e) => updateStatus(lead.$id, e.target.value as LeadStatus)}
                        disabled={updating === lead.$id}
                        className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_STYLES[s].label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
