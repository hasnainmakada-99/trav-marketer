'use client';

import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';
const IS_YCLOUD_MODE = (process.env.NEXT_PUBLIC_WHATSAPP_OUTBOUND_MODE || 'ycloud').toLowerCase() === 'ycloud';
// 90 s when visible; polling pauses automatically when the tab is hidden.
const POLL_INTERVAL_MS = 90_000;

type Tab = 'inbox' | 'send';

interface Conversation {
  phone: string;
  name: string | null;
  lastMessage: string;
  lastTimestamp: string;
  lastType: 'incoming' | 'outgoing';
  unreadCount: number;
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

// ── minimal inline markdown renderer ──────────────────────────────────────────
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
      parts.push(<a key={key++} href={full} target="_blank" rel="noopener noreferrer" className="underline break-all">{full}</a>);
    } else if (full.startsWith('**') && full.endsWith('**')) {
      parts.push(<strong key={key++}>{full.slice(2, -2)}</strong>);
    } else if (full.startsWith('*') && full.endsWith('*')) {
      parts.push(<strong key={key++}>{full.slice(1, -1)}</strong>);
    } else if (full.startsWith('_') && full.endsWith('_')) {
      parts.push(<em key={key++}>{full.slice(1, -1)}</em>);
    } else if (full.startsWith('~') && full.endsWith('~')) {
      parts.push(<span key={key++} className="line-through">{full.slice(1, -1)}</span>);
    } else {
      parts.push(full);
    }
    lastIndex = start + full.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function renderMessage(raw?: string | null): ReactNode {
  const text = (raw || '').trim();
  if (!text) return <span className="opacity-50 italic">empty</span>;
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push(<ul key={i} className="list-disc pl-5 space-y-0.5">{items.map((it, idx) => <li key={idx}>{renderInlineMarkdown(it)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(<ol key={i} className="list-decimal pl-5 space-y-0.5">{items.map((it, idx) => <li key={idx}>{renderInlineMarkdown(it)}</li>)}</ol>);
      continue;
    }
    const para: string[] = [lines[i]];
    i++;
    while (i < lines.length && lines[i].trim() && !/^[-*\d]/.test(lines[i].trim())) {
      para.push(lines[i]); i++;
    }
    blocks.push(<p key={i} className="whitespace-pre-wrap">{renderInlineMarkdown(para.join('\n'))}</p>);
  }
  return <div className="space-y-1.5">{blocks}</div>;
}

function formatTime(ts?: string) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  return isToday
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function initials(name?: string | null, phone?: string) {
  if (name) return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
  return (phone || '?').slice(-2);
}

function preview(msg: string, type?: string) {
  const v = (msg || '').trim();
  if (v && v !== '[unsupported]') return v.replace(/\n+/g, ' ');
  if (type === 'image') return '📷 Photo';
  if (type === 'audio' || type === 'voice') return '🎙 Voice message';
  if (type === 'video') return '🎬 Video';
  if (type === 'document') return '📄 Document';
  if (type === 'sticker') return '🎭 Sticker';
  return '📎 Attachment';
}

function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
      {msg}
    </div>
  );
}

export default function WhatsAppPage() {
  const [tab, setTab] = useState<Tab>('inbox');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type });

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">WhatsApp</h1>
            <p className="text-xs text-gray-400 mt-0.5">AI-powered customer conversations</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {IS_YCLOUD_MODE ? 'YCloud API' : 'WA Bridge'}
          </div>
        </div>
        <div className="flex gap-0 mt-4 border-b border-gray-200 -mb-4">
          {(['inbox', 'send'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'inbox' ? 'Inbox' : 'Send Message'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'inbox' && <InboxTab showToast={showToast} />}
        {tab === 'send' && <SendTab showToast={showToast} />}
      </div>
    </div>
  );
}

// ── INBOX ──────────────────────────────────────────────────────────────────────
function InboxTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConvos = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/conversations?teamId=${encodeURIComponent(TEAM_ID)}`);
      const data = await res.json();
      setConvos(data.conversations || []);
    } catch { /* keep stale */ } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadThread = useCallback(async (phone: string) => {
    setThreadLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/conversations?teamId=${encodeURIComponent(TEAM_ID)}&phone=${encodeURIComponent(phone)}`);
      const data = await res.json();
      setThread(data.messages || []);
    } catch {
      setThread([]);
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => { loadConvos(); }, [loadConvos]);
  useEffect(() => {
    const start = () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        if (document.visibilityState === 'hidden') return; // skip when tab not focused
        loadConvos(true);
        if (selected) loadThread(selected);
      }, POLL_INTERVAL_MS);
    };
    start();
    document.addEventListener('visibilitychange', start);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', start);
    };
  }, [loadConvos, loadThread, selected]);

  useEffect(() => {
    if (selected) loadThread(selected);
  }, [selected, loadThread]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [thread]);

  const handleSend = async () => {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: selected, message: reply.trim(), teamId: TEAM_ID }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed');
      setReply('');
      showToast('Message sent');
      await loadThread(selected);
      await loadConvos(true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setSending(false);
    }
  };

  const filtered = convos.filter(c =>
    !search || (c.name || c.phone).toLowerCase().includes(search.toLowerCase())
  );
  const selectedConvo = convos.find(c => c.phone === selected);

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-72 xl:w-80 border-r border-gray-200 bg-white flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-100 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">Conversations</span>
            <button onClick={() => loadConvos()} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">Refresh</button>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or number..."
            className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-8 text-center">
              <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-600" />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-400">
              {search ? 'No matches' : 'No conversations yet'}
            </div>
          )}
          {filtered.map(c => (
            <button
              key={c.phone}
              onClick={() => setSelected(c.phone)}
              className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${selected === c.phone ? 'bg-emerald-50 border-l-2 border-l-emerald-500' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {initials(c.name, c.phone)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-semibold text-gray-900 truncate">{c.name || c.phone}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {c.unreadCount > 0 && (
                        <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                          {c.unreadCount}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400">{formatTime(c.lastTimestamp)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {c.lastType === 'outgoing' && <span className="text-emerald-600 mr-1">✓</span>}
                    {preview(c.lastMessage)}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 flex flex-col min-w-0" style={{ backgroundImage: 'radial-gradient(circle, #e5e7eb 1px, transparent 1px)', backgroundSize: '20px 20px', backgroundColor: '#f9fafb' }}>
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-white shadow-md flex items-center justify-center mx-auto mb-4 text-4xl">💬</div>
              <p className="font-semibold text-gray-600">Select a conversation</p>
              <p className="text-sm text-gray-400 mt-1">to view messages</p>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-shrink-0 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {initials(selectedConvo?.name, selected)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm">{selectedConvo?.name || selected}</p>
                <p className="text-xs text-gray-400 font-mono">{selected}</p>
              </div>
              <a
                href={`https://wa.me/${selected}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 font-medium"
              >
                Open in WA
              </a>
            </div>

            {/* Messages */}
            <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {threadLoading && (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600" />
                </div>
              )}
              {!threadLoading && thread.length === 0 && (
                <div className="text-center text-sm text-gray-400 py-8">No messages</div>
              )}
              {thread.map(m => {
                const isOut = m.type === 'outgoing';
                const msgText = (m.text || '').trim();
                const isMedia = !msgText || msgText === '[unsupported]';
                return (
                  <div key={m.$id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 shadow-sm ${
                      isOut
                        ? 'bg-emerald-500 text-white rounded-tr-sm'
                        : 'bg-white text-gray-800 rounded-tl-sm'
                    }`}>
                      {isMedia ? (
                        <p className={`text-sm italic ${isOut ? 'text-emerald-100' : 'text-gray-400'}`}>
                          {preview(m.text || '', m.messageType)}
                        </p>
                      ) : (
                        <div className="text-sm leading-relaxed">
                          {renderMessage(m.text)}
                        </div>
                      )}
                      <p className={`text-[10px] mt-1.5 text-right ${isOut ? 'text-emerald-100' : 'text-gray-400'}`}>
                        {formatTime(m.timestamp || m.createdAt)}
                        {isOut && m.status && ` · ${m.status}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Reply box */}
            <div className="bg-white border-t border-gray-200 p-3 flex gap-2 items-end flex-shrink-0">
              <textarea
                value={reply}
                onChange={e => setReply(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Type a message… (Enter to send)"
                rows={1}
                className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none leading-relaxed"
                style={{ minHeight: '42px', maxHeight: '120px' }}
              />
              <button
                onClick={handleSend}
                disabled={sending || !reply.trim()}
                className="px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex-shrink-0 transition-colors"
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── SEND TAB ───────────────────────────────────────────────────────────────────
function SendTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const normalizedPhone = phone.replace(/[^\d]/g, '');
    if (!normalizedPhone || normalizedPhone.length < 8) {
      showToast('Enter a valid phone with country code (e.g. 919876543210)', 'error');
      return;
    }
    if (!message.trim()) {
      showToast('Message cannot be empty', 'error');
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizedPhone, message: message.trim(), teamId: TEAM_ID }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed');
      showToast('Message sent successfully');
      setMessage('');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to send', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-xl mx-auto">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-1">Send Message</h2>
          <p className="text-sm text-gray-400 mb-6">Send a manual message to any WhatsApp number. Works within the 24-hour window.</p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone number</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">+</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="919876543210"
                  className="w-full pl-7 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">Include country code — e.g. 91 for India</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Message</label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={6}
                placeholder="Hi! Just wanted to follow up on your travel enquiry..."
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">{message.length} / 1000 characters</p>
            </div>

            <button
              onClick={handleSend}
              disabled={sending || !phone.trim() || !message.trim()}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {sending ? 'Sending…' : 'Send Message'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
