'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CRM_STATUS_META,
  CRM_STATUS_ORDER,
  coerceLeadStatus,
  type CrmLeadStatus,
} from '@/lib/crm';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';
const POLL_INTERVAL_RAW = Number(process.env.NEXT_PUBLIC_WHATSAPP_POLL_MS || '15000');
const POLL_INTERVAL_MS = Number.isFinite(POLL_INTERVAL_RAW)
  ? Math.max(30_000, POLL_INTERVAL_RAW)
  : 30_000;
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
      parts.push(
        <a
          key={key++}
          href={full}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all underline"
        >
          {full}
        </a>
      );
    } else if (full.startsWith('**') && full.endsWith('**')) {
      parts.push(<strong key={key++}>{full.slice(2, -2)}</strong>);
    } else if (full.startsWith('*') && full.endsWith('*')) {
      parts.push(<strong key={key++}>{full.slice(1, -1)}</strong>);
    } else if (full.startsWith('_') && full.endsWith('_')) {
      parts.push(<em key={key++}>{full.slice(1, -1)}</em>);
    } else if (full.startsWith('~') && full.endsWith('~')) {
      parts.push(
        <span key={key++} className="line-through">
          {full.slice(1, -1)}
        </span>
      );
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
  const isToday = date.toDateString() === now.toDateString();
  return isToday
    ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function initials(name?: string | null, phone?: string) {
  if (name) {
    return name
      .split(' ')
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('');
  }
  return (phone || '?').slice(-2);
}

function preview(msg: string, type?: string) {
  const trimmed = (msg || '').trim();
  if (trimmed && trimmed !== '[unsupported]') return trimmed.replace(/\n+/g, ' ');
  if (type === 'image') return 'Photo attachment';
  if (type === 'audio' || type === 'voice') return 'Voice note';
  if (type === 'video') return 'Video attachment';
  if (type === 'document') return 'Document attachment';
  return 'Attachment';
}

function conversationListUrl() {
  return `/api/whatsapp/conversations?teamId=${encodeURIComponent(TEAM_ID)}&_ts=${Date.now()}`;
}

function conversationThreadUrl(phone: string) {
  return `/api/whatsapp/conversations?teamId=${encodeURIComponent(TEAM_ID)}&phone=${encodeURIComponent(phone)}&_ts=${Date.now()}`;
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

function Toast({
  msg,
  type,
  onClose,
}: {
  msg: string;
  type: 'success' | 'error';
  onClose: () => void;
}) {
  useEffect(() => {
    const timeout = setTimeout(onClose, 3200);
    return () => clearTimeout(timeout);
  }, [onClose]);

  return (
    <div
      className={`fixed right-4 top-4 z-50 rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
        type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
      }`}
    >
      {msg}
    </div>
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
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
          >
            Close
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export default function WhatsAppPage() {
  const [tab, setTab] = useState<Tab>('inbox');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [focusPhone, setFocusPhone] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      <div className="border-b border-slate-200/70 bg-white/80 px-5 py-3.5 backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-600/70">
              WhatsApp CRM
            </p>
            <h1 className="mt-1.5 text-2xl font-semibold text-slate-950">Customer conversations</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Real names from CRM contacts, AI-driven lead stages, and only this Traventions bot
              number&apos;s conversation history inside one inbox.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            YCloud channel live
          </div>
        </div>
        <div className="mt-3 flex gap-2 border-b border-slate-200">
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

      <div className="min-h-0 flex-1">
        {tab === 'inbox' ? (
          <InboxTab
            showToast={(msg, type = 'success') => setToast({ msg, type })}
            focusPhone={focusPhone}
            onFocusConsumed={() => setFocusPhone(null)}
          />
        ) : (
          <SendTab
            showToast={(msg, type = 'success') => setToast({ msg, type })}
            onMessageSent={(phone, toastMessage) => {
              setFocusPhone(phone);
              setTab('inbox');
              setToast({ msg: toastMessage, type: 'success' });
            }}
          />
        )}
      </div>
    </div>
  );
}

function InboxTab({
  showToast,
  focusPhone,
  onFocusConsumed,
}: {
  showToast: (msg: string, type?: 'success' | 'error') => void;
  focusPhone: string | null;
  onFocusConsumed: () => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<CrmLeadStatus, number>>({
    new_lead: 0,
    normal_conversation: 0,
    connected: 0,
    converted: 0,
    closed: 0,
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
  const threadRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousUnreadRef = useRef(0);
  const selectedPhoneRef = useRef<string | null>(null);

  useEffect(() => {
    selectedPhoneRef.current = selectedPhone;
  }, [selectedPhone]);

  const loadConversations = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setLoading(true);
      }

      try {
        const response = await fetch(conversationListUrl(), { cache: 'no-store' });
        const data = await response.json();
        const nextConversations = (data.conversations || []) as Conversation[];
        const unreadCount = nextConversations.reduce(
          (sum, conversation) => sum + (conversation.unreadCount || 0),
          0
        );

        if (silent && unreadCount > previousUnreadRef.current) {
          showToast('A new WhatsApp message just arrived.');
        }

        previousUnreadRef.current = unreadCount;
        setConversations(nextConversations);
        setStatusCounts(
          data.statusCounts || {
            new_lead: 0,
            normal_conversation: 0,
            connected: 0,
            converted: 0,
            closed: 0,
          }
        );

        const currentSelectedPhone = selectedPhoneRef.current;
        if (!currentSelectedPhone && nextConversations.length > 0) {
          setSelectedPhone(nextConversations[0].phone);
        } else if (
          currentSelectedPhone &&
          !nextConversations.some((conversation) => conversation.phone === currentSelectedPhone)
        ) {
          setSelectedPhone(nextConversations[0]?.phone || null);
        }
      } catch {
        if (!silent) {
          showToast('Unable to load WhatsApp conversations.', 'error');
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [showToast]
  );

  const loadThread = useCallback(async (phone: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setThreadLoading(true);
    }
    try {
      const response = await fetch(conversationThreadUrl(phone), { cache: 'no-store' });
      const data = (await response.json()) as ThreadResponse;
      setThread(data.messages || []);
      setThreadInfo(data);
      setContactForm({ name: data.name || '', email: data.email || '' });
    } catch {
      if (!silent) {
        setThread([]);
        setThreadInfo(null);
      }
    } finally {
      if (!silent) {
        setThreadLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedPhone) return;
    void loadThread(selectedPhone);
  }, [selectedPhone, loadThread]);

  useEffect(() => {
    if (!focusPhone) return;
    setSelectedPhone(focusPhone);
    onFocusConsumed();
  }, [focusPhone, onFocusConsumed]);

  useEffect(() => {
    const startPolling = () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        void loadConversations({ silent: true });
        if (selectedPhoneRef.current) {
          void loadThread(selectedPhoneRef.current, { silent: true });
        }
      }, POLL_INTERVAL_MS);
    };

    startPolling();
    document.addEventListener('visibilitychange', startPolling);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', startPolling);
    };
  }, [loadConversations, loadThread]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [thread]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((conversation) => {
      const matchesFilter = filter === 'all' || conversation.crmStatus === filter;
      if (!matchesFilter) return false;

      if (!search) return true;
      const query = search.toLowerCase();
      return (
        conversation.name.toLowerCase().includes(query) ||
        conversation.phone.toLowerCase().includes(query) ||
        String(conversation.email || '').toLowerCase().includes(query)
      );
    });
  }, [conversations, filter, search]);

  const selectedConversation = conversations.find((conversation) => conversation.phone === selectedPhone);

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
      showToast('Message sent successfully.');
      await loadThread(selectedPhone);
      await loadConversations({ silent: true });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to send', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleSaveContact = async () => {
    if (!selectedPhone) return;
    setContactSaving(true);
    try {
      const response = await fetch('/api/customers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId: TEAM_ID,
          phone: selectedPhone,
          name: contactForm.name,
          email: contactForm.email,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to save contact');
      showToast('Contact details updated.');
      setShowEditContact(false);
      await loadConversations({ silent: true });
      await loadThread(selectedPhone);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to save contact', 'error');
    } finally {
      setContactSaving(false);
    }
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
      showToast(`Imported ${data.total} contacts into the CRM.`);
      setContactsText('');
      setShowImportContacts(false);
      await loadConversations();
      if (selectedPhoneRef.current) {
        await loadThread(selectedPhoneRef.current, { silent: true });
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to import contacts', 'error');
    } finally {
      setImportingContacts(false);
    }
  };

  return (
    <>
      <div className="flex h-full min-h-0">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.08),transparent_24%),linear-gradient(180deg,#f8fbff_0%,#eef6ff_100%)]">
          {!selectedPhone ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <div className="max-w-md rounded-[32px] border border-slate-200 bg-white/80 p-10 text-center shadow-xl shadow-slate-200/60 backdrop-blur">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">
                  Inbox ready
                </p>
                <h3 className="mt-3 text-2xl font-semibold text-slate-900">
                  Select a conversation to open the full chat history
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  The client sees the full thread, lead stage, and contact identity in one place.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-200/70 bg-white/80 px-5 py-4 backdrop-blur">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`flex h-14 w-14 items-center justify-center rounded-[20px] bg-gradient-to-br ${CRM_STATUS_META[threadInfo?.crmStatus || selectedConversation?.crmStatus || 'normal_conversation'].panel} text-base font-bold text-white shadow-lg`}>
                      {initials(threadInfo?.name || selectedConversation?.name, selectedPhone)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-xl font-semibold text-slate-950">
                          {threadInfo?.name || selectedConversation?.name || selectedPhone}
                        </h2>
                        <StatusBadge status={threadInfo?.crmStatus || selectedConversation?.crmStatus || 'normal_conversation'} />
                      </div>
                      <p className="mt-1 truncate text-sm text-slate-500">{selectedPhone}</p>
                      {threadInfo?.email && (
                        <p className="truncate text-xs text-slate-400">{threadInfo.email}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setShowContactsDrawer(true)}
                      className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      Contacts
                    </button>
                    <button
                      onClick={() => setShowEditContact(true)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Edit contact
                    </button>
                    <a
                      href={`https://wa.me/${selectedPhone}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                    >
                      Open in WhatsApp
                    </a>
                  </div>
                </div>
                {threadInfo?.notes && (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <span className="font-semibold">Lead note:</span> {threadInfo.notes}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => setShowContactsDrawer(true)}
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                  >
                    Browse contacts
                    <span className="ml-1 text-[11px] opacity-80">{filteredConversations.length}</span>
                  </button>
                  <button
                    onClick={() => loadConversations()}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
                  >
                    Refresh inbox
                  </button>
                  <button
                    onClick={() => setShowImportContacts(true)}
                    className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
                  >
                    Import contacts
                  </button>
                </div>
              </div>

              <div ref={threadRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 lg:px-6">
                {threadLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-600" />
                  </div>
                ) : thread.length === 0 ? (
                  <div className="py-16 text-center text-sm text-slate-400">No messages yet.</div>
                ) : (
                  thread.map((message) => {
                    const outgoing = message.type === 'outgoing';
                    const messageText = (message.text || '').trim();
                    const isMedia = !messageText || messageText === '[unsupported]';
                    return (
                      <div key={message.$id} className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[78%] rounded-[24px] px-4 py-3 shadow-sm ${
                            outgoing
                              ? 'rounded-tr-sm bg-emerald-500 text-white'
                              : 'rounded-tl-sm border border-white/80 bg-white text-slate-800'
                          }`}
                        >
                          {isMedia ? (
                            <p className={`text-sm italic ${outgoing ? 'text-emerald-50' : 'text-slate-400'}`}>
                              {preview(message.text || '', message.messageType)}
                            </p>
                          ) : (
                            renderMessage(message.text)
                          )}
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

              <div className="border-t border-slate-200/70 bg-white/90 px-4 py-4 backdrop-blur lg:px-6">
                <div className="flex gap-3">
                  <textarea
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        handleSend();
                      }
                    }}
                    rows={1}
                    placeholder="Type a reply and press Enter to send"
                    className="min-h-[52px] flex-1 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  />
                  <button
                    onClick={handleSend}
                    disabled={sending || !reply.trim()}
                    className="rounded-[22px] bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sending ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {showContactsDrawer && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/35 backdrop-blur-sm">
          <button
            aria-label="Close contacts drawer"
            className="flex-1"
            onClick={() => setShowContactsDrawer(false)}
          />
          <aside className="flex h-full w-full max-w-[420px] min-w-[320px] flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Contacts</p>
                  <h3 className="mt-1 text-xl font-semibold text-slate-950">WhatsApp contact list</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Browse, search, and jump between all conversations without squeezing the chat window.
                  </p>
                </div>
                <button
                  onClick={() => setShowContactsDrawer(false)}
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => loadConversations()}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Refresh
                </button>
                <button
                  onClick={() => setShowImportContacts(true)}
                  className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                >
                  Import
                </button>
              </div>

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, phone, or email"
                className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />

              <div className="mt-3 overflow-x-auto pb-1">
                <div className="flex min-w-max gap-2">
                  <button
                    onClick={() => setFilter('all')}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      filter === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    All Chats
                    <span className="ml-1 text-[11px] opacity-80">{conversations.length}</span>
                  </button>
                  {CRM_STATUS_ORDER.map((status) => (
                    <button
                      key={status}
                      onClick={() => setFilter(status)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        filter === status
                          ? CRM_STATUS_META[status].soft
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {CRM_STATUS_META[status].label}
                      <span className="ml-1 text-[11px] opacity-80">{statusCounts[status] || 0}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Conversations</p>
                <p className="text-sm text-slate-500">{filteredConversations.length} visible chats</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {conversations.length} total
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-600" />
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <p className="text-lg font-semibold text-slate-700">No conversations found</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Try a different search or import your saved contact names.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 overflow-hidden rounded-[24px] border border-slate-100 bg-white shadow-sm">
                  {filteredConversations.map((conversation) => {
                    const isSelected = selectedPhone === conversation.phone;
                    return (
                      <button
                        key={conversation.phone}
                        onClick={() => {
                          setSelectedPhone(conversation.phone);
                          setShowContactsDrawer(false);
                        }}
                        className={`w-full px-4 py-3 text-left transition ${
                          isSelected ? 'bg-emerald-50/80' : 'bg-transparent hover:bg-slate-50/80'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${CRM_STATUS_META[conversation.crmStatus].panel} text-sm font-bold text-white shadow-lg`}
                          >
                            {initials(conversation.name, conversation.phone)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-slate-900">{conversation.name}</p>
                                <p className="truncate text-xs text-slate-400">{conversation.phone}</p>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-[11px] text-slate-400">
                                  {formatTime(conversation.lastTimestamp)}
                                </span>
                                {conversation.unreadCount > 0 && (
                                  <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                                    {conversation.unreadCount}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <StatusBadge status={conversation.crmStatus} />
                              {conversation.email && (
                                <span className="truncate text-[11px] text-slate-400">
                                  {conversation.email}
                                </span>
                              )}
                            </div>
                            <p className="mt-2 truncate text-sm text-slate-500">
                              {conversation.lastType === 'outgoing' ? 'You: ' : ''}
                              {preview(conversation.lastMessage)}
                            </p>
                          </div>
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

      {showEditContact && selectedPhone && (
        <Modal
          title="Edit contact identity"
          subtitle="Update the saved name or email for this WhatsApp number."
          onClose={() => setShowEditContact(false)}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone</label>
              <input
                value={selectedPhone}
                disabled
                className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Saved name</label>
              <input
                value={contactForm.name}
                onChange={(event) => setContactForm((form) => ({ ...form, name: event.target.value }))}
                placeholder="Rahul Sharma"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <input
                value={contactForm.email}
                onChange={(event) => setContactForm((form) => ({ ...form, email: event.target.value }))}
                placeholder="rahul@email.com"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <button
              onClick={handleSaveContact}
              disabled={contactSaving}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {contactSaving ? 'Saving...' : 'Save contact'}
            </button>
          </div>
        </Modal>
      )}

      {showImportContacts && (
        <Modal
          title="Import saved contacts"
          subtitle="Paste rows in CSV style like Name, Phone, Email. This is how we map real names into the WhatsApp inbox."
          onClose={() => setShowImportContacts(false)}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Example:
              <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-emerald-900">
                Name, Phone, Email{'\n'}Rahul Sharma, 919876543210, rahul@email.com{'\n'}Aisha Khan, 917000112233, aisha@email.com
              </pre>
            </div>
            <textarea
              value={contactsText}
              onChange={(event) => setContactsText(event.target.value)}
              rows={10}
              placeholder="Paste contacts here..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
            <button
              onClick={handleImportContacts}
              disabled={importingContacts || !contactsText.trim()}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {importingContacts ? 'Importing...' : 'Import contacts into CRM'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function SendTab({
  showToast,
  onMessageSent,
}: {
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onMessageSent: (phone: string, toastMessage: string) => void;
}) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [reviewPhone, setReviewPhone] = useState('');
  const [sendingReview, setSendingReview] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [lastSentPhone, setLastSentPhone] = useState<string | null>(null);

  const handleSend = async () => {
    const normalizedPhone = phone.replace(/[^\d]/g, '');
    if (!normalizedPhone || normalizedPhone.length < 8) {
      showToast('Enter a valid phone with country code.', 'error');
      return;
    }
    if (!message.trim()) {
      showToast('Message cannot be empty.', 'error');
      return;
    }
    setSendStatus(null);
    setSendError(null);
    setSending(true);
    try {
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ phone: normalizedPhone, message: message.trim(), teamId: TEAM_ID }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to send');
      setMessage('');
      setLastSentPhone(normalizedPhone);
      setSendStatus(`Message queued successfully for ${normalizedPhone}. Opening the live inbox thread now.`);
      onMessageSent(normalizedPhone, `Message sent to ${normalizedPhone}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send';
      setSendError(message);
      showToast(message, 'error');
    } finally {
      setSending(false);
    }
  };

  const handleSendReview = async () => {
    const normalizedPhone = reviewPhone.replace(/[^\d]/g, '');
    if (!normalizedPhone || normalizedPhone.length < 8) {
      showToast('Enter a valid phone with country code.', 'error');
      return;
    }
    setReviewStatus(null);
    setReviewError(null);
    setSendingReview(true);
    try {
      const reviewMessage = `Hi! Thank you for choosing *Traventions* for your travel plans.\n\nWe would love your feedback.\nPlease share your review here:\n${GOOGLE_REVIEW_LINK}\n\nYour review helps us a lot.`;
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ phone: normalizedPhone, message: reviewMessage, teamId: TEAM_ID }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to send review request');
      setReviewPhone('');
      setLastSentPhone(normalizedPhone);
      setReviewStatus(`Review request queued successfully for ${normalizedPhone}. Opening the live inbox thread now.`);
      onMessageSent(normalizedPhone, `Review request sent to ${normalizedPhone}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send';
      setReviewError(message);
      showToast(message, 'error');
    } finally {
      setSendingReview(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
        <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[1.18fr_0.82fr]">
          <section className="rounded-[32px] border border-slate-200 bg-white/90 p-6 shadow-xl shadow-slate-200/60 backdrop-blur">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400/80">
            Manual outreach
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">Send a direct WhatsApp message</h2>
          <p className="mt-1 text-sm text-slate-500">
            Useful for a follow-up, human intervention, or a fast quote during the 24-hour window.
          </p>

          <div className="mt-6 space-y-4">
            {sendStatus && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                <p>{sendStatus}</p>
                {lastSentPhone && (
                  <p className="mt-1 text-xs text-emerald-600/90">
                    If WhatsApp delivery is still catching up, the thread for {lastSentPhone} will
                    still appear as the latest CRM activity in the inbox.
                  </p>
                )}
              </div>
            )}
            {sendError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {sendError}
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone number</label>
              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="919876543210"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Message</label>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={8}
                placeholder="Hi! I wanted to follow up on your holiday enquiry..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
              <p className="mt-1 text-xs text-slate-400">{message.length} / 1000 characters</p>
            </div>
            <button
              onClick={handleSend}
              disabled={sending || !phone.trim() || !message.trim()}
              className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {sending ? 'Sending...' : 'Send message'}
            </button>
          </div>
        </section>

        <section className="rounded-[32px] border border-amber-200 bg-[linear-gradient(180deg,#fff9ed_0%,#ffffff_100%)] p-6 shadow-xl shadow-amber-100/70">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-amber-500/75">
            Review growth
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">Request a Google review</h2>
          <p className="mt-1 text-sm text-slate-500">
            Send a polished review request to any customer directly from the CRM.
          </p>

          <div className="mt-6 space-y-4">
            {reviewStatus && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                <p>{reviewStatus}</p>
                {lastSentPhone && (
                  <p className="mt-1 text-xs text-emerald-600/90">
                    The review request is queued through YCloud and will show up in the inbox thread
                    for {lastSentPhone}.
                  </p>
                )}
              </div>
            )}
            {reviewError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {reviewError}
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Customer phone</label>
              <input
                type="tel"
                value={reviewPhone}
                onChange={(event) => setReviewPhone(event.target.value)}
                placeholder="919876543210"
                className="w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
              />
            </div>
            <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">Preview</p>
              <p className="mt-2 whitespace-pre-wrap">
                Hi! Thank you for choosing *Traventions* for your travel plans.
                {'\n\n'}We would love your feedback.
                {'\n'}{GOOGLE_REVIEW_LINK}
              </p>
            </div>
            <button
              onClick={handleSendReview}
              disabled={sendingReview || !reviewPhone.trim()}
              className="rounded-2xl bg-amber-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
            >
              {sendingReview ? 'Sending...' : 'Send review request'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
