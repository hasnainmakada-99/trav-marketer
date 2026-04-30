'use client';

import { useEffect, useState, useCallback } from 'react';

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
            Connected via Meta Cloud API
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
        {tab === 'setup' && <SetupTab />}
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
        `/api/whatsapp/conversations/${encodeURIComponent(
          phone
        )}?teamId=${encodeURIComponent(TEAM_ID)}`
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
    loadConvos();
  }, [loadConvos]);

  useEffect(() => {
    if (selected) loadThread(selected);
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
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {m.text || `[${m.messageType || 'media'}]`}
                    </p>
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

  const handleSend = async () => {
    if (!phone.trim()) {
      showToast('Phone number required', 'error');
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
        phone: phone.trim(),
        teamId: TEAM_ID,
      };

      if (mode === 'text') {
        body.message = message.trim();
      } else {
        body.templateName = templateName.trim();
        body.message = ' '; // route requires `message` field
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
      setTemplateName('');
      setTemplateParams('');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Send Message</h2>
        <p className="text-sm text-gray-500 mb-6">
          Free-form text only works inside the 24-hour customer-initiated window.
          Outside that window, use a pre-approved template.
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
              Recipient phone (with country code, no +)
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
                placeholder="Hi! Just wanted to follow up…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}

          {mode === 'template' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template name
                </label>
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="hello_world"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template parameters (comma-separated, in order)
                </label>
                <input
                  type="text"
                  value={templateParams}
                  onChange={(e) => setTemplateParams(e.target.value)}
                  placeholder="John, 12 May, ₹2500"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </>
          )}

          <button
            onClick={handleSend}
            disabled={sending}
            className="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send Message'}
          </button>
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/whatsapp/templates');
      const data = await res.json();
      if (data.error) setError(data.error);
      setTemplates(data.templates || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
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
              Templates approved by Meta. Use these for marketing & utility
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

        {loading && (
          <div className="text-center py-12 text-sm text-gray-400">
            Loading templates…
          </div>
        )}

        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 mb-4">
            <strong>Note:</strong> {error}
          </div>
        )}

        {!loading && templates.length === 0 && !error && (
          <div className="text-center py-12 text-sm text-gray-400">
            No templates found. Create them in Meta Business Manager →
            WhatsApp → Message Templates.
          </div>
        )}

        <div className="grid gap-3">
          {templates.map((t) => {
            const body = t.components?.find((c) => c.type === 'BODY');
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
function SetupTab() {
  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : 'https://trav-marketer.vercel.app/api/whatsapp/webhook';
  const verifyToken = 'travai-webhook-verify-token-2026';

  const copy = (text: string) => navigator.clipboard.writeText(text);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
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
