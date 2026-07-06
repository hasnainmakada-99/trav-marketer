'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CRM_STATUS_META,
  CRM_STATUS_ORDER,
  coerceLeadStatus,
  type CrmLeadStatus,
} from '@/lib/crm';
import { humanizeMessagePreview } from '@/lib/message-preview';
import { Avatar } from '@/components/ui/avatar';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { showToast } from '@/components/ui/toast';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';
const GOOGLE_REVIEW_LINK =
  process.env.NEXT_PUBLIC_GOOGLE_REVIEW_LINK || 'https://g.page/r/traventions/review';

type Tab = 'inbox' | 'send';
type InboxFilter = 'all' | CrmLeadStatus;

interface Conversation {
  phone: string;
  name: string;
  email?: string | null;
  lastMessage: string;
  lastTimestamp: string;
  lastType: 'incoming' | 'outgoing';
  unreadCount: number;
  crmStatus: CrmLeadStatus;
}

interface Message {
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
  messages: Message[];
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
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

function renderMessage(raw?: string | null): ReactNode {
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

function conversationListUrl() {
  return `/api/whatsapp/conversations?teamId=${encodeURIComponent(TEAM_ID)}&_ts=${Date.now()}`;
}

function conversationThreadUrl(phone: string) {
  return `/api/whatsapp/conversations?teamId=${encodeURIComponent(TEAM_ID)}&phone=${encodeURIComponent(phone)}&_ts=${Date.now()}`;
}

export default function WhatsAppPage() {
  const [tab, setTab] = useState<Tab>('inbox');
  const [focusPhone, setFocusPhone] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200/70 bg-white/80 px-4 py-3.5 backdrop-blur sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-600/70">
              WhatsApp CRM
            </p>
            <h1 className="mt-1.5 text-2xl font-semibold text-slate-950">Customer conversations</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Real names from CRM contacts, AI-driven lead stages, and conversation history in one inbox.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            YCloud channel live
          </div>
        </div>
        <div className="mt-3 overflow-x-auto border-b border-slate-200">
          <div className="flex min-w-max gap-2">
            {(['inbox', 'send'] as Tab[]).map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                className={`-mb-px rounded-t-2xl border-b-2 px-5 py-3 text-sm font-semibold transition ${
                  tab === item
                    ? 'border-emerald-500 text-emerald-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {item === 'inbox' ? 'Inbox' : 'Send Message'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'inbox' ? (
          <InboxTab
            focusPhone={focusPhone}
            onFocusConsumed={() => setFocusPhone(null)}
          />
        ) : (
          <SendTab
            onMessageSent={(phone, toastMessage) => {
              setFocusPhone(phone);
              setTab('inbox');
              showToast({ message: toastMessage, type: 'success' });
            }}
          />
        )}
      </div>
    </div>
  );
}

function InboxTab({
  focusPhone,
  onFocusConsumed,
}: {
  focusPhone: string | null;
  onFocusConsumed: () => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<CrmLeadStatus, number>>({
    new_lead: 0, normal_conversation: 0, connected: 0, converted: 0, closed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [thread, setThread] = useState<Message[]>([]);
  const [threadInfo, setThreadInfo] = useState<ThreadResponse | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [showContactsDrawer, setShowContactsDrawer] = useState(false);
  const [showEditContact, setShowEditContact] = useState(false);
  const [showImportContacts, setShowImportContacts] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '' });
  const [contactSaving, setContactSaving] = useState(false);
  const [contactsText, setContactsText] = useState('');
  const [importingContacts, setImportingContacts] = useState(false);
  const [showPurchases, setShowPurchases] = useState(false);
  const [purchasePhone, setPurchasePhone] = useState<string | null>(null);
  const [waPurchases, setWaPurchases] = useState<Array<{ $id: string; amount: number; service?: string; date?: string; status?: string; customerName?: string | null }>>([]);
  const [waPurchasesLoading, setWaPurchasesLoading] = useState(false);
  const [showWaAddPurchase, setShowWaAddPurchase] = useState(false);
  const [waPurchaseForm, setWaPurchaseForm] = useState({ service: '', amount: '', date: new Date().toISOString().slice(0, 10), status: 'completed' });
  const [waPurchaseSaving, setWaPurchaseSaving] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  const previousUnreadRef = useRef(0);
  const selectedPhoneRef = useRef<string | null>(null);

  useEffect(() => { selectedPhoneRef.current = selectedPhone; }, [selectedPhone]);

  const loadConversations = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);
    try {
      const response = await fetch(conversationListUrl(), { cache: 'no-store' });
      const data = await response.json();
      const nextConversations = (data.conversations || []) as Conversation[];
      const unreadCount = nextConversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
      if (silent && unreadCount > previousUnreadRef.current) {
        showToast({ message: 'New WhatsApp message arrived.', type: 'info' });
      }
      previousUnreadRef.current = unreadCount;
      setConversations(nextConversations);
      setStatusCounts(data.statusCounts || { new_lead: 0, normal_conversation: 0, connected: 0, converted: 0, closed: 0 });
      const currentSelected = selectedPhoneRef.current;
      if (!currentSelected && nextConversations.length > 0) {
        setSelectedPhone(nextConversations[0].phone);
      } else if (currentSelected && !nextConversations.some((c) => c.phone === currentSelected)) {
        setSelectedPhone(nextConversations[0]?.phone || null);
      }
    } catch {
      if (!silent) showToast({ message: 'Unable to load conversations.', type: 'error' });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadThread = useCallback(async (phone: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setThreadLoading(true);
    try {
      const response = await fetch(conversationThreadUrl(phone), { cache: 'no-store' });
      const data = (await response.json()) as ThreadResponse;
      setThread(data.messages || []);
      setThreadInfo(data);
      setContactForm({ name: data.name || '', email: data.email || '' });
    } catch {
      if (!silent) { setThread([]); setThreadInfo(null); }
    } finally {
      if (!silent) setThreadLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(() => void loadConversations()); }, [loadConversations]);
  useEffect(() => { if (selectedPhone) queueMicrotask(() => void loadThread(selectedPhone)); }, [selectedPhone, loadThread]);
  useEffect(() => { if (focusPhone) { setSelectedPhone(focusPhone); onFocusConsumed(); } }, [focusPhone, onFocusConsumed]);
  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [thread]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (filter !== 'all' && c.crmStatus !== filter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q) || String(c.email || '').toLowerCase().includes(q);
    });
  }, [conversations, filter, search]);

  const selectedConversation = conversations.find((c) => c.phone === selectedPhone);

  const handleSend = async () => {
    if (!selectedPhone || !reply.trim()) return;
    setSending(true);
    try {
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: selectedPhone, message: reply.trim(), teamId: TEAM_ID }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to send');
      setReply('');
      showToast({ message: 'Message sent.', type: 'success' });
      await loadThread(selectedPhone);
      await loadConversations({ silent: true });
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : 'Failed to send', type: 'error' });
    } finally { setSending(false); }
  };

  const handleSaveContact = async () => {
    if (!selectedPhone) return;
    setContactSaving(true);
    try {
      const response = await fetch('/api/customers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: TEAM_ID, phone: selectedPhone, name: contactForm.name, email: contactForm.email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to save contact');
      showToast({ message: 'Contact updated.', type: 'success' });
      setShowEditContact(false);
      await loadConversations({ silent: true });
      await loadThread(selectedPhone);
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : 'Failed to save contact', type: 'error' });
    } finally { setContactSaving(false); }
  };

  const loadPurchases = async (phone: string) => {
    setWaPurchasesLoading(true);
    try {
      const res = await fetch(`/api/transactions?teamId=${encodeURIComponent(TEAM_ID)}&limit=50`);
      const data = await res.json();
      const all = (data.documents || []) as Array<{ $id: string; amount: number; service?: string; date?: string; status?: string; customerName?: string | null; phone?: string }>;
      setWaPurchases(all.filter(tx => tx.phone?.includes(phone.replace(/[^\d]/g, '')) || tx.customerName?.toLowerCase().includes(phone.toLowerCase())));
    } catch { setWaPurchases([]); }
    finally { setWaPurchasesLoading(false); }
  };

  const handleWaAddPurchase = async () => {
    if (!purchasePhone || !waPurchaseForm.amount) { showToast({ message: 'Amount is required', type: 'error' }); return; }
    setWaPurchaseSaving(true);
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId: TEAM_ID, customerName: threadInfo?.name || selectedConversation?.name || purchasePhone,
          phone: purchasePhone, service: waPurchaseForm.service,
          amount: Number(waPurchaseForm.amount), date: waPurchaseForm.date, status: waPurchaseForm.status,
        }),
      });
      if (!res.ok) throw new Error('Failed to save purchase');
      showToast({ message: 'Purchase recorded', type: 'success' });
      setShowWaAddPurchase(false);
      setWaPurchaseForm({ service: '', amount: '', date: new Date().toISOString().slice(0, 10), status: 'completed' });
      await loadPurchases(purchasePhone);
    } catch (e) { showToast({ message: e instanceof Error ? e.message : 'Failed', type: 'error' }); }
    finally { setWaPurchaseSaving(false); }
  };

  const handleImportContacts = async () => {
    if (!contactsText.trim()) return;
    setImportingContacts(true);
    try {
      const response = await fetch('/api/customers/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: TEAM_ID, contactsText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to import contacts');
      showToast({ message: `Imported ${data.total} contacts.`, type: 'success' });
      setContactsText('');
      setShowImportContacts(false);
      await loadConversations();
      if (selectedPhoneRef.current) await loadThread(selectedPhoneRef.current, { silent: true });
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : 'Failed to import', type: 'error' });
    } finally { setImportingContacts(false); }
  };

  return (
    <>
      <div className="flex h-full min-h-0">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.06),transparent_24%),linear-gradient(180deg,#f8fbff_0%,#eef6ff_100%)]">
          {!selectedPhone ? (
            <div className="flex flex-1 items-center justify-center px-4 sm:px-6">
              <div className="max-w-md rounded-[32px] border border-slate-200 bg-white/80 p-6 text-center shadow-xl shadow-slate-200/60 backdrop-blur sm:p-10">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100">
                  <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                  </svg>
                </div>
                <h3 className="mt-4 text-xl font-semibold text-slate-900">Select a conversation</h3>
                <p className="mt-2 text-sm text-slate-500">Choose a chat from the sidebar to view the full thread.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Contact header */}
              <div className="border-b border-slate-200/70 bg-white/80 px-4 py-4 backdrop-blur sm:px-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex items-start gap-3 sm:items-center sm:gap-4">
                    <Avatar name={threadInfo?.name || selectedConversation?.name} phone={selectedPhone} size="lg" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-xl font-semibold text-slate-950">
                          {threadInfo?.name || selectedConversation?.name || 'WhatsApp contact'}
                        </h2>
                        <StatusBadge status={threadInfo?.crmStatus || selectedConversation?.crmStatus || 'normal_conversation'} />
                      </div>
                      <p className="mt-1 truncate text-sm text-slate-500">{selectedPhone}</p>
                      {threadInfo?.email && <p className="truncate text-xs text-slate-400">{threadInfo.email}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setShowEditContact(true)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                      Edit contact
                    </button>
                    <button onClick={() => { setShowPurchases(true); setPurchasePhone(selectedPhone); void loadPurchases(selectedPhone); }} className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-100">
                      Purchases
                    </button>
                    <a href={`https://wa.me/${selectedPhone}`} target="_blank" rel="noreferrer"
                      className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100">
                      Open in WhatsApp
                    </a>
                  </div>
                </div>
                {threadInfo?.notes && (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <span className="font-semibold">Note:</span> {threadInfo.notes}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => setShowContactsDrawer(true)} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200">
                    Browse contacts
                  </button>
                  <button onClick={() => loadConversations()} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50">
                    Refresh
                  </button>
                  <button onClick={() => setShowImportContacts(true)} className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100">
                    Import contacts
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div ref={threadRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5 lg:px-6">
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

              {/* Reply input */}
              <div className="border-t border-slate-200/70 bg-white/90 px-4 py-4 backdrop-blur sm:px-5 lg:px-6">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    rows={1}
                    placeholder="Type a reply and press Enter to send"
                    className="min-h-[52px] flex-1 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  />
                  <button onClick={handleSend} disabled={sending || !reply.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-[22px] bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                    {sending && (
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {sending ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Contacts drawer */}
      {showContactsDrawer && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/35 backdrop-blur-sm">
          <button aria-label="Close" className="flex-1" onClick={() => setShowContactsDrawer(false)} />
          <aside className="flex h-full w-[min(100vw,24rem)] min-w-0 flex-col border-l border-slate-200 bg-white shadow-2xl sm:max-w-[420px]">
            <div className="border-b border-slate-100 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Contacts</p>
                  <h3 className="mt-1 text-xl font-semibold text-slate-950">WhatsApp contact list</h3>
                </div>
                <button onClick={() => setShowContactsDrawer(false)}
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
                  Close
                </button>
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, phone, or email"
                className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setFilter('all')}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  All ({conversations.length})
                </button>
                {CRM_STATUS_ORDER.map((status) => (
                  <button key={status} onClick={() => setFilter(status)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filter === status ? CRM_STATUS_META[status].soft : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {CRM_STATUS_META[status].shortLabel} ({statusCounts[status] || 0})
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-3">
              {loading ? (
                <LoadingSpinner />
              ) : filteredConversations.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <p className="font-semibold text-slate-700">No conversations found</p>
                  <p className="mt-1 text-sm text-slate-400">Try a different search or import contacts.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 overflow-hidden rounded-[24px] border border-slate-100 bg-white shadow-sm">
                  {filteredConversations.map((c) => {
                    const isSelected = selectedPhone === c.phone;
                    return (
                      <button key={c.phone} onClick={() => { setSelectedPhone(c.phone); setShowContactsDrawer(false); }}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${isSelected ? 'bg-emerald-50/80' : 'bg-transparent hover:bg-slate-50/80'}`}>
                        <Avatar name={c.name} phone={c.phone} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate font-semibold text-slate-900">{c.name}</p>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <span className="text-[11px] text-slate-400">{formatTime(c.lastTimestamp)}</span>
                              {c.unreadCount > 0 && (
                                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">{c.unreadCount}</span>
                              )}
                            </div>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <StatusBadge status={c.crmStatus} size="sm" />
                          </div>
                          <p className="mt-1 truncate text-sm text-slate-500">
                            {c.lastType === 'outgoing' ? 'You: ' : ''}{preview(c.lastMessage)}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Edit contact modal */}
      {showEditContact && selectedPhone && (
        <Modal title="Edit contact" onClose={() => setShowEditContact(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone</label>
              <input value={selectedPhone} disabled className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-500" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Name</label>
              <input value={contactForm.name} onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Rahul Sharma"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <input value={contactForm.email} onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="rahul@email.com"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
            </div>
            <button onClick={handleSaveContact} disabled={contactSaving}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
              {contactSaving ? 'Saving...' : 'Save contact'}
            </button>
          </div>
        </Modal>
      )}

      {/* Import contacts modal */}
      {showImportContacts && (
        <Modal title="Import contacts" onClose={() => setShowImportContacts(false)}>
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Format: <code className="text-xs">Name, Phone, Email</code> per line
            </div>
            <textarea value={contactsText} onChange={(e) => setContactsText(e.target.value)} rows={8}
              placeholder="Rahul Sharma, 919876543210, rahul@email.com"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
            <button onClick={handleImportContacts} disabled={importingContacts || !contactsText.trim()}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
              {importingContacts ? 'Importing...' : 'Import contacts'}
            </button>
          </div>
        </Modal>
      )}

      {/* Purchases modal */}
      {showPurchases && purchasePhone && (
        <Modal title={`Purchases — ${threadInfo?.name || purchasePhone}`} onClose={() => setShowPurchases(false)} size="lg">
          <div className="flex flex-col gap-4" style={{ maxHeight: '70vh' }}>
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">{waPurchases.length} transaction{waPurchases.length !== 1 ? 's' : ''}</p>
              <Button onClick={() => setShowWaAddPurchase(true)}>Add Purchase</Button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto">
              {waPurchasesLoading ? (
                <LoadingSpinner />
              ) : waPurchases.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">No purchases recorded yet.</div>
              ) : (
                waPurchases.map((tx) => (
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
      {showWaAddPurchase && (
        <Modal title="Add Purchase" onClose={() => setShowWaAddPurchase(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Service</label>
              <input value={waPurchaseForm.service} onChange={(e) => setWaPurchaseForm({ ...waPurchaseForm, service: e.target.value })} placeholder="Goa package, Bali trip..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Amount (INR) *</label>
              <input value={waPurchaseForm.amount} onChange={(e) => setWaPurchaseForm({ ...waPurchaseForm, amount: e.target.value })} type="number" placeholder="35000"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Date</label>
              <input value={waPurchaseForm.date} onChange={(e) => setWaPurchaseForm({ ...waPurchaseForm, date: e.target.value })} type="date"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Status</label>
              <select value={waPurchaseForm.status} onChange={(e) => setWaPurchaseForm({ ...waPurchaseForm, status: e.target.value })}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100">
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="refunded">Refunded</option>
              </select>
            </div>
            <Button onClick={handleWaAddPurchase} loading={waPurchaseSaving} className="w-full">Save Purchase</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function SendTab({ onMessageSent }: { onMessageSent: (phone: string, toastMessage: string) => void }) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [reviewPhone, setReviewPhone] = useState('');
  const [sendingReview, setSendingReview] = useState(false);

  const handleSend = async () => {
    const normalizedPhone = phone.replace(/[^\d]/g, '');
    if (normalizedPhone.length < 8) { showToast({ message: 'Enter a valid phone with country code.', type: 'error' }); return; }
    if (!message.trim()) { showToast({ message: 'Message cannot be empty.', type: 'error' }); return; }
    setSending(true);
    try {
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ phone: normalizedPhone, message: message.trim(), teamId: TEAM_ID }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to send');
      setMessage('');
      onMessageSent(normalizedPhone, `Message sent to ${normalizedPhone}`);
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : 'Failed to send', type: 'error' });
    } finally { setSending(false); }
  };

  const handleSendReview = async () => {
    const normalizedPhone = reviewPhone.replace(/[^\d]/g, '');
    if (normalizedPhone.length < 8) { showToast({ message: 'Enter a valid phone.', type: 'error' }); return; }
    setSendingReview(true);
    try {
      const reviewMessage = `Hi! Thank you for choosing *Traventions* for your travel plans.\n\nWe would love your feedback.\nPlease share your review here:\n${GOOGLE_REVIEW_LINK}\n\nYour review helps us a lot.`;
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ phone: normalizedPhone, message: reviewMessage, teamId: TEAM_ID }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to send review request');
      setReviewPhone('');
      onMessageSent(normalizedPhone, `Review request sent to ${normalizedPhone}`);
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : 'Failed to send', type: 'error' });
    } finally { setSendingReview(false); }
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[32px] border border-slate-200 bg-white/90 p-5 shadow-xl shadow-slate-200/60 backdrop-blur sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400/80">Manual outreach</p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-950">Send WhatsApp message</h2>
              <p className="mt-1 text-sm text-slate-500">Follow-up, human intervention, or quick quote during the 24-hour window.</p>
            </div>
          </div>
          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone number</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="919876543210"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Message</label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={8}
                placeholder="Hi! I wanted to follow up on your holiday enquiry..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
              <p className="mt-1 text-xs text-slate-400">{message.length} / 1000</p>
            </div>
            <button onClick={handleSend} disabled={sending || !phone.trim() || !message.trim()}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
              {sending && (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {sending ? 'Sending...' : 'Send message'}
            </button>
          </div>
        </section>

        <section className="rounded-[32px] border border-amber-200 bg-[linear-gradient(180deg,#fff9ed_0%,#ffffff_100%)] p-5 shadow-xl shadow-amber-100/70 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-amber-500/75">Review growth</p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-950">Request Google review</h2>
              <p className="mt-1 text-sm text-slate-500">Send a review request directly from the CRM.</p>
            </div>
          </div>
          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Customer phone</label>
              <input type="tel" value={reviewPhone} onChange={(e) => setReviewPhone(e.target.value)} placeholder="919876543210"
                className="w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100" />
            </div>
            <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">Preview</p>
              <p className="mt-2 whitespace-pre-wrap">
                Hi! Thank you for choosing *Traventions* for your travel plans.{'\n\n'}We would love your feedback.{'\n'}{GOOGLE_REVIEW_LINK}
              </p>
            </div>
            <button onClick={handleSendReview} disabled={sendingReview || !reviewPhone.trim()}
              className="inline-flex items-center gap-2 rounded-2xl bg-amber-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50">
              {sendingReview && (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {sendingReview ? 'Sending...' : 'Send review request'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
