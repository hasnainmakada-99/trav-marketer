'use client';

import { useEffect, useState, useCallback, type ReactNode } from 'react';

const TEAM_ID =
  process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

type Tab = 'inbox' | 'send' | 'templates' | 'setup';

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

interface Template {
  id?: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: Array<{ type: string; text?: string; format?: string }>;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|https?:\/\/[^\s]+)/g;
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(pattern)) {
    const full = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    if (/^https?:\/\//.test(full)) {
      parts.push(
        <a
          key={`md-${key++}`}
          href={full}
          target="_blank"
          rel="noopener noreferrer"
          className="underline break-all"
        >
          {full}
        </a>
      );
    } else if (full.startsWith('`') && full.endsWith('`')) {
      parts.push(
        <code key={`md-${key++}`} className="px-1 rounded bg-black/10 font-mono text-[0.95em]">
          {full.slice(1, -1)}
        </code>
      );
    } else if (
      (full.startsWith('**') && full.endsWith('**')) ||
      (full.startsWith('__') && full.endsWith('__'))
    ) {
      parts.push(<strong key={`md-${key++}`}>{full.slice(2, -2)}</strong>);
    } else if (
      full.startsWith('*') &&
      full.endsWith('*')
    ) {
      // WhatsApp uses single *...* for bold.
      parts.push(<strong key={`md-${key++}`}>{full.slice(1, -1)}</strong>);
    } else if (full.startsWith('_') && full.endsWith('_')) {
      parts.push(<em key={`md-${key++}`}>{full.slice(1, -1)}</em>);
    } else if (full.startsWith('~') && full.endsWith('~')) {
      parts.push(<span key={`md-${key++}`} className="line-through">{full.slice(1, -1)}</span>);
    } else {
      parts.push(full);
    }

    lastIndex = start + full.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function renderMessageMarkdown(raw?: string | null): ReactNode {
  const text = (raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) {
    return <span className="opacity-70">[empty]</span>;
  }

  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i += 1;
      }
      blocks.push(
        <pre
          key={`code-${i}`}
          className="whitespace-pre-wrap break-words rounded bg-black/10 p-2 font-mono text-xs"
        >
          {codeLines.join('\n')}
        </pre>
      );
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line)) {
      blocks.push(<hr key={`hr-${i}`} className="my-2 border-current/20" />);
      i += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const headingClass =
        level === 1 ? 'text-base font-bold' : level === 2 ? 'text-sm font-semibold' : 'text-sm font-semibold';
      blocks.push(
        <div key={`h-${i}`} className={`${headingClass} mt-1`}>
          {renderInlineMarkdown(content)}
        </div>
      );
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="list-disc pl-5 space-y-1">
          {items.map((item, idx) => (
            <li key={`uli-${idx}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="list-decimal pl-5 space-y-1">
          {items.map((item, idx) => (
            <li key={`oli-${idx}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (/^>\s+/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s+/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s+/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`quote-${i}`}
          className="border-l-2 border-current/25 pl-3 italic opacity-90"
        >
          {quoteLines.map((q, idx) => (
            <p key={`q-${idx}`}>{renderInlineMarkdown(q)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    const paragraphLines = [lines[i]];
    i += 1;
    while (i < lines.length) {
      const probe = lines[i].trim();
      if (
        !probe ||
        /^[-*]\s+/.test(probe) ||
        /^\d+\.\s+/.test(probe) ||
        /^(-{3,}|\*{3,})$/.test(probe) ||
        /^(#{1,3})\s+(.+)$/.test(probe)
      ) {
        break;
      }
      paragraphLines.push(lines[i]);
      i += 1;
    }
    const para = paragraphLines.join('\n');
    blocks.push(
      <p key={`p-${i}`} className="whitespace-pre-wrap">
        {renderInlineMarkdown(para)}
      </p>
    );
  }

  return <div className="space-y-2">{blocks}</div>;
}

function formatMessagePreview(text?: string | null, messageType?: string) {
  const value = (text || '').trim();
  if (value.length > 0) return value;
  if (messageType === 'text') return 'Text message';
  return `[${messageType || 'media'}]`;
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
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div
      className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm text-white ${
        type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
      }`}
    >
      {msg}
    </div>
  );
}

function formatTime(ts?: string) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

export default function WhatsAppPage() {
  const [tab, setTab] = useState<Tab>('inbox');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(
    null
  );

  const showToast = (msg: string, type: 'success' | 'error' = 'success') =>
    setToast({ msg, type });

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">WhatsApp</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Customer chats, broadcasts, and templates
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Connected via WA Web Bridge
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 border-b border-gray-200 -mb-4">
          {(['inbox', 'send', 'templates', 'setup'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'inbox' && 'Inbox'}
              {t === 'send' && 'Send Message'}
              {t === 'templates' && 'Templates'}
              {t === 'setup' && 'Setup'}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {tab === 'inbox' && <InboxTab showToast={showToast} />}
        {tab === 'send' && <SendTab showToast={showToast} />}
        {tab === 'templates' && <TemplatesTab showToast={showToast} />}
        {tab === 'setup' && <SetupTab showToast={showToast} />}
      </div>
    </div>
  );
}

// ---------- INBOX TAB ----------
function InboxTab({
  showToast,
}: {
  showToast: (m: string, t?: 'success' | 'error') => void;
}) {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const loadConvos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/whatsapp/conversations?teamId=${encodeURIComponent(TEAM_ID)}`
      );
      const data = await res.json();
      setConvos(data.conversations || []);
    } catch {
      setConvos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadThread = useCallback(async (phone: string) => {
    setThreadLoading(true);
    try {
      const res = await fetch(
        `/api/whatsapp/conversations?teamId=${encodeURIComponent(
          TEAM_ID
        )}&phone=${encodeURIComponent(phone)}`
      );
      const data = await res.json();
      setThread(data.messages || []);
    } catch {
      setThread([]);
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadConvos();
    }, 0);
    return () => clearTimeout(t);
  }, [loadConvos]);

  useEffect(() => {
    if (!selected) return;
    const t = setTimeout(() => {
      void loadThread(selected);
    }, 0);
    return () => clearTimeout(t);
  }, [selected, loadThread]);

  const handleSendReply = async () => {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: selected,
          message: reply.trim(),
          teamId: TEAM_ID,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed');
      setReply('');
      showToast('Message sent', 'success');
      await loadThread(selected);
      await loadConvos();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to send', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full flex">
      {/* Conversation list */}
      <div className="w-80 border-r border-gray-200 bg-white flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-200 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">
            Conversations
          </span>
          <button
            onClick={loadConvos}
            className="text-xs text-emerald-600 hover:text-emerald-700"
          >
            Refresh
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-6 text-center text-sm text-gray-400">
              Loading…
            </div>
          )}
          {!loading && convos.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-400">
              No conversations yet. Customer messages will appear here.
            </div>
          )}
          {convos.map((c) => (
            <button
              key={c.phone}
              onClick={() => setSelected(c.phone)}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                selected === c.phone ? 'bg-emerald-50' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900 truncate">
                      {c.name || c.phone}
                    </span>
                    {c.unreadCount > 0 && (
                      <span className="bg-emerald-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {c.lastType === 'outgoing' && '✓ '}
                    {c.lastMessage}
                  </p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {formatTime(c.lastTimestamp)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 flex flex-col bg-gray-100 min-w-0">
        {!selected && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <div className="text-5xl mb-3">💬</div>
              <p className="text-sm">Select a conversation to view messages</p>
            </div>
          </div>
        )}

        {selected && (
          <>
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-sm">
                {(convos.find((c) => c.phone === selected)?.name ||
                  selected)?.[0]?.toUpperCase()}
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-900">
                  {convos.find((c) => c.phone === selected)?.name || selected}
                </div>
                <div className="text-xs text-gray-500">{selected}</div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {threadLoading && (
                <div className="text-center text-xs text-gray-400">Loading…</div>
              )}
              {!threadLoading && thread.length === 0 && (
                <div className="text-center text-xs text-gray-400">
                  No messages
                </div>
              )}
              {thread.map((m) => (
                <div
                  key={m.$id}
                  className={`flex ${
                    m.type === 'outgoing' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-md px-3 py-2 rounded-lg shadow-sm ${
                      m.type === 'outgoing'
                        ? 'bg-emerald-500 text-white rounded-br-none'
                        : 'bg-white text-gray-800 rounded-bl-none'
                    }`}
                  >
                    <div className="text-sm break-words leading-relaxed">
                      {renderMessageMarkdown(
                        formatMessagePreview(m.text, m.messageType)
                      )}
                    </div>
                    <p
                      className={`text-[10px] mt-1 ${
                        m.type === 'outgoing'
                          ? 'text-emerald-100'
                          : 'text-gray-400'
                      } text-right`}
                    >
                      {formatTime(m.timestamp || m.createdAt)}
                      {m.type === 'outgoing' && m.status && ` · ${m.status}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-white border-t border-gray-200 p-3 flex gap-2">
              <input
                type="text"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendReply();
                  }
                }}
                placeholder="Type a message…"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                onClick={handleSendReply}
                disabled={sending || !reply.trim()}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- SEND TAB ----------
function SendTab({
  showToast,
}: {
  showToast: (m: string, t?: 'success' | 'error') => void;
}) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateParams, setTemplateParams] = useState('');
  const [mode, setMode] = useState<'text' | 'template'>('text');
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templatesNotice, setTemplatesNotice] = useState<string | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<
    'connected' | 'disconnected' | 'unknown' | 'bridge_only'
  >('unknown');

  const approvedTemplates = templates.filter((t) => t.status === 'APPROVED');

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    setTemplatesNotice(null);
    try {
      const res = await fetch('/api/whatsapp/templates', { cache: 'no-store' });
      const data = await res.json();
      setTemplates(data.templates || []);
      if (
        data.integrationStatus === 'connected' ||
        data.integrationStatus === 'disconnected' ||
        data.integrationStatus === 'bridge_only'
      ) {
        setIntegrationStatus(data.integrationStatus);
      } else {
        setIntegrationStatus('unknown');
      }
      setTemplatesError(data.error || null);
      setTemplatesNotice(data.notice || null);
    } catch (error) {
      setTemplatesError(
        error instanceof Error ? error.message : 'Failed to load templates'
      );
      setTemplatesNotice(null);
      setIntegrationStatus('unknown');
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadTemplates();
    }, 0);
    return () => clearTimeout(t);
  }, [loadTemplates]);

  const handleSend = async () => {
    const normalizedPhone = phone.replace(/[^\d]/g, '');
    if (!normalizedPhone) {
      showToast('Phone number required', 'error');
      return;
    }
    if (normalizedPhone.length < 8) {
      showToast('Enter a valid phone number with country code', 'error');
      return;
    }
    if (mode === 'text' && !message.trim()) {
      showToast('Message required', 'error');
      return;
    }
    if (mode === 'template' && !templateName.trim()) {
      showToast('Template name required', 'error');
      return;
    }

    setSending(true);
    try {
      const body: Record<string, unknown> = {
        phone: normalizedPhone,
        teamId: TEAM_ID,
      };

      if (mode === 'text') {
        body.message = message.trim();
      } else {
        body.templateName = templateName.trim();
        body.templateParams = templateParams
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
      }

      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed');

      showToast('Message sent successfully', 'success');
      setMessage('');
      setTemplateParams('');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-1">Send Message</h2>
          <p className="text-sm text-gray-500 mb-6">
            Text messages work inside the 24-hour window. For outreach or old chats, use approved templates.
          </p>

          <div className="flex gap-2 mb-5">
            <button
              onClick={() => setMode('text')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                mode === 'text'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              Text Message
            </button>
            <button
              onClick={() => setMode('template')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                mode === 'template'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              Template Message
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Recipient phone (country code, digits only)
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="919876543210"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {mode === 'text' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder="Hi! Just wanted to follow up..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            )}

            {mode === 'template' && (
              <>
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Template
                  </label>
                  <button
                    onClick={() => void loadTemplates()}
                    className="text-xs text-emerald-600 hover:text-emerald-700"
                  >
                    Refresh templates
                  </button>
                </div>

                {templatesError && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                    {templatesError}
                  </div>
                )}
                {templatesNotice && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                    {templatesNotice}
                  </div>
                )}

                <select
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  disabled={integrationStatus === 'bridge_only'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">
                    {templatesLoading
                      ? 'Loading templates...'
                      : integrationStatus === 'bridge_only'
                      ? 'Template sync unavailable in bridge mode'
                      : approvedTemplates.length
                      ? 'Select approved template'
                      : 'No approved templates found'}
                  </option>
                  {approvedTemplates.map((t) => (
                    <option key={`${t.name}-${t.language}`} value={t.name}>
                      {t.name} ({t.language})
                    </option>
                  ))}
                </select>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Template parameters (comma-separated, in order)
                  </label>
                  <input
                    type="text"
                    value={templateParams}
                    onChange={(e) => setTemplateParams(e.target.value)}
                    placeholder="John, 12 May, 2500"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </>
            )}

            <button
              onClick={handleSend}
              disabled={sending || (mode === 'template' && !templateName)}
              className="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {sending ? 'Sending...' : 'Send Message'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 h-fit">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Delivery Readiness</h3>
          <div className="space-y-2 text-sm">
            <p className="text-gray-700">
              Integration:{' '}
              <span
                className={`font-medium ${
                  integrationStatus === 'connected'
                    ? 'text-emerald-700'
                    : integrationStatus === 'bridge_only'
                    ? 'text-blue-700'
                    : integrationStatus === 'disconnected'
                    ? 'text-rose-700'
                    : 'text-gray-700'
                }`}
              >
                {integrationStatus}
              </span>
            </p>
            <p className="text-gray-700">
              Approved templates: <span className="font-medium">{approvedTemplates.length}</span>
            </p>
            <p className="text-xs text-gray-500 pt-2">
              {integrationStatus === 'bridge_only'
                ? 'Live chat works in bridge mode. Cloud API templates become available after Meta app/token setup.'
                : 'If template mode is empty, check Meta token/app and template approvals in Meta Business Manager.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- TEMPLATES TAB ----------
function TemplatesTab({
  showToast,
}: {
  showToast: (m: string, t?: 'success' | 'error') => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<
    'connected' | 'disconnected' | 'unknown' | 'bridge_only'
  >('unknown');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/whatsapp/templates', { cache: 'no-store' });
      const data = await res.json();
      if (data.error) setError(data.error);
      if (data.notice) setNotice(data.notice);
      if (
        data.integrationStatus === 'connected' ||
        data.integrationStatus === 'disconnected' ||
        data.integrationStatus === 'bridge_only'
      ) {
        setIntegrationStatus(data.integrationStatus);
      } else {
        setIntegrationStatus('unknown');
      }
      setTemplates(data.templates || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setNotice(null);
      setIntegrationStatus('unknown');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Approved Templates
            </h2>
            <p className="text-sm text-gray-500">
              Templates approved by Meta. Use these for marketing and utility
              messages outside the 24-hour window.
            </p>
          </div>
          <button
            onClick={load}
            className="px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 rounded-lg"
          >
            Refresh
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-3 mb-4 text-xs text-gray-600 flex items-center justify-between">
          <span>
            Integration:{' '}
            <strong
              className={
                integrationStatus === 'connected'
                  ? 'text-emerald-700'
                  : integrationStatus === 'bridge_only'
                  ? 'text-blue-700'
                  : integrationStatus === 'disconnected'
                  ? 'text-rose-700'
                  : 'text-gray-700'
              }
            >
              {integrationStatus}
            </strong>
          </span>
          <span>
            Total templates: <strong>{templates.length}</strong>
          </span>
        </div>

        {loading && (
          <div className="text-center py-12 text-sm text-gray-400">
            Loading templates...
          </div>
        )}

        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 mb-4">
            <strong>Note:</strong> {error}
          </div>
        )}
        {notice && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 mb-4">
            <strong>Info:</strong> {notice}
          </div>
        )}

        {!loading && templates.length === 0 && !error && (
          <div className="text-center py-12 text-sm text-gray-400">
            No templates found. Create them in Meta Business Manager {'->'}
            {' '}WhatsApp {'->'} Message Templates.
          </div>
        )}

        <div className="grid gap-3">
          {templates.map((t) => {
            const body = t.components?.find(
              (c) => (c.type || '').toUpperCase() === 'BODY'
            );
            return (
              <div
                key={`${t.name}-${t.language}`}
                className="bg-white border border-gray-200 rounded-lg p-4"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm">
                      {t.name}
                    </h3>
                    <div className="flex gap-2 mt-1">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {t.language}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        {t.category}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          t.status === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {t.status}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(t.name);
                      showToast(`Copied: ${t.name}`, 'success');
                    }}
                    className="text-xs text-emerald-600 hover:text-emerald-700"
                  >
                    Copy name
                  </button>
                </div>
                {body?.text && (
                  <p className="text-sm text-gray-700 bg-gray-50 rounded p-2 mt-2 whitespace-pre-wrap">
                    {body.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- SETUP TAB ----------
function SetupTab({
  showToast,
}: {
  showToast: (m: string, t?: 'success' | 'error') => void;
}) {
  const [bridgeState, setBridgeState] = useState<{
    status: 'starting' | 'connected' | 'disconnected' | 'qr_required' | 'error';
    qrText: string | null;
    reason: string | null;
    linkedPhone: string | null;
    heartbeatAt: string | null;
    updatedAt: string | null;
  } | null>(null);
  const [bridgeLoading, setBridgeLoading] = useState(true);
  const [bridgeActionLoading, setBridgeActionLoading] = useState<
    null | 'restart' | 'relink'
  >(null);
  const [clockMs, setClockMs] = useState(0);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : 'https://trav-marketer.vercel.app/api/whatsapp/webhook';
  const verifyToken = 'travai-webhook-verify-token-2026';

  const copy = (text: string) => navigator.clipboard.writeText(text);

  const loadBridgeState = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/wa-bridge/state?teamId=${encodeURIComponent(TEAM_ID)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (res.ok) {
        setBridgeState(data);
      }
    } catch {
      // Keep last known state; transient network errors are expected.
    } finally {
      setBridgeLoading(false);
    }
  }, []);

  useEffect(() => {
    const run = () => {
      void loadBridgeState();
    };
    const initial = setTimeout(run, 0);
    const t = setInterval(run, 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [loadBridgeState]);

  useEffect(() => {
    const tick = () => {
      setClockMs(new Date().getTime());
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, []);

  const statusLabel =
    bridgeState?.status === 'connected'
      ? 'Connected'
      : bridgeState?.status === 'qr_required'
      ? 'QR Required'
      : bridgeState?.status === 'disconnected'
      ? 'Disconnected'
      : bridgeState?.status === 'error'
      ? 'Error'
      : 'Starting';

  const heartbeatAgeMs = bridgeState?.heartbeatAt
    ? clockMs - new Date(bridgeState.heartbeatAt).getTime()
    : null;
  const bridgeOffline =
    !bridgeLoading &&
    typeof heartbeatAgeMs === 'number' &&
    heartbeatAgeMs > 60_000;
  const heartbeatAgeLabel =
    typeof heartbeatAgeMs === 'number'
      ? `${Math.max(0, Math.floor(heartbeatAgeMs / 1000))}s ago`
      : null;

  const statusStyles =
    bridgeOffline
      ? 'bg-rose-100 text-rose-700'
      : bridgeState?.status === 'connected'
      ? 'bg-emerald-100 text-emerald-700'
      : bridgeState?.status === 'qr_required'
      ? 'bg-amber-100 text-amber-700'
      : bridgeState?.status === 'error'
      ? 'bg-rose-100 text-rose-700'
      : 'bg-gray-100 text-gray-700';

  const qrPreviewUrl =
    bridgeState?.qrText && bridgeState.status === 'qr_required'
      ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
          bridgeState.qrText
        )}`
      : null;

  const sendBridgeAction = async (action: 'restart' | 'relink') => {
    setBridgeActionLoading(action);
    try {
      const res = await fetch('/api/wa-bridge/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: TEAM_ID, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to send bridge action');
      }
      showToast(
        action === 'relink'
          ? 'Relink requested. QR should appear shortly.'
          : 'Restart requested. Bridge will reconnect shortly.',
        'success'
      );
      setTimeout(() => {
        void loadBridgeState();
      }, 1200);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to send bridge action';
      showToast(message, 'error');
    } finally {
      setBridgeActionLoading(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Bridge Link Status</h2>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusStyles}`}>
              {bridgeLoading ? 'Checking…' : statusLabel}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            This status comes from the always-on Oracle bridge. If device gets unlinked, scan the QR below to relink.
          </p>
          {bridgeOffline && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
              <p className="text-xs text-rose-700">
                Bridge appears offline. Last heartbeat was{' '}
                {heartbeatAgeLabel || 'unknown'}. Start/restart the bridge process to resume updates.
              </p>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4 items-start">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 flex items-center justify-center min-h-[240px]">
              {qrPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrPreviewUrl}
                  alt="WhatsApp relink QR"
                  className="w-[220px] h-[220px] rounded bg-white p-1"
                />
              ) : (
                <p className="text-xs text-gray-500 text-center px-3">
                  QR will appear here automatically when relink is required.
                </p>
              )}
            </div>

            <div className="space-y-2 text-sm text-gray-700">
              <p>
                <span className="font-medium">Status:</span>{' '}
                {bridgeLoading ? 'Checking…' : statusLabel}
              </p>
              {bridgeState?.reason && (
                <p>
                  <span className="font-medium">Reason:</span> {bridgeState.reason}
                </p>
              )}
              {bridgeState?.heartbeatAt && (
                <p>
                  <span className="font-medium">Last heartbeat:</span>{' '}
                  {new Date(bridgeState.heartbeatAt).toLocaleString()}
                  {heartbeatAgeLabel ? ` (${heartbeatAgeLabel})` : ''}
                </p>
              )}
              <p className="text-xs text-gray-500 pt-2">
                Open WhatsApp on the linked phone → Linked Devices → Link a Device → scan QR.
              </p>
              <div className="pt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => sendBridgeAction('restart')}
                  disabled={Boolean(bridgeActionLoading)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bridgeActionLoading === 'restart'
                    ? 'Restarting...'
                    : 'Restart Bridge'}
                </button>
                <button
                  onClick={() => sendBridgeAction('relink')}
                  disabled={Boolean(bridgeActionLoading)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bridgeActionLoading === 'relink'
                    ? 'Requesting QR...'
                    : 'Force Re-link (New QR)'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-1">
            WhatsApp Webhook Configuration
          </h2>
          <p className="text-sm text-gray-500 mb-5">
            Paste these values in Meta Business Manager → WhatsApp → Configuration.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Callback URL
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={webhookUrl}
                  className="flex-1 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono"
                />
                <button
                  onClick={() => copy(webhookUrl)}
                  className="px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 rounded-lg border border-emerald-200"
                >
                  Copy
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Verify token
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={verifyToken}
                  className="flex-1 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono"
                />
                <button
                  onClick={() => copy(verifyToken)}
                  className="px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 rounded-lg border border-emerald-200"
                >
                  Copy
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Webhook fields to subscribe
              </label>
              <p className="text-xs text-gray-500">
                In Meta Configuration, subscribe to:{' '}
                <code className="bg-gray-100 px-1 rounded">messages</code>,{' '}
                <code className="bg-gray-100 px-1 rounded">message_status</code>
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-3">
            Required Environment Variables
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            These must be set in Vercel → Project → Settings → Environment
            Variables.
          </p>
          <div className="space-y-2">
            {[
              {
                key: 'WHATSAPP_TOKEN',
                hint: 'Permanent System User access token from Meta Business Manager',
              },
              {
                key: 'WHATSAPP_PHONE_NUMBER_ID',
                hint: 'From WhatsApp Manager → API Setup',
              },
              {
                key: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
                hint: 'WABA ID from WhatsApp Manager → Settings',
              },
              {
                key: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
                hint: 'Already set: travai-webhook-verify-token-2026',
              },
            ].map((v) => (
              <div
                key={v.key}
                className="flex items-start justify-between gap-2 py-2 border-b border-gray-100 last:border-0"
              >
                <div>
                  <code className="text-sm font-mono text-gray-900">
                    {v.key}
                  </code>
                  <p className="text-xs text-gray-500 mt-0.5">{v.hint}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
          <h3 className="font-semibold text-blue-900 mb-2 text-sm">
            Quick setup checklist
          </h3>
          <ol className="text-sm text-blue-800 space-y-1 list-decimal pl-5">
            <li>Create WhatsApp Business Account in Meta Business Manager</li>
            <li>Add and verify the client&rsquo;s phone number</li>
            <li>
              Generate a permanent System User access token with{' '}
              <code className="bg-white px-1 rounded">whatsapp_business_messaging</code>{' '}
              + <code className="bg-white px-1 rounded">whatsapp_business_management</code>{' '}
              permissions
            </li>
            <li>Paste callback URL + verify token above into Meta Configuration</li>
            <li>
              Subscribe to <code className="bg-white px-1 rounded">messages</code>{' '}
              and{' '}
              <code className="bg-white px-1 rounded">message_status</code>{' '}
              webhooks
            </li>
            <li>Add all 4 env vars to Vercel and redeploy</li>
            <li>Submit message templates for Meta approval</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
