import dotenv from 'dotenv';
import axios from 'axios';
import qrcode from 'qrcode-terminal';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
} from '@whiskeysockets/baileys';

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const BRIDGE_SHARED_SECRET = process.env.BRIDGE_SHARED_SECRET;
const BRIDGE_INSTANCE_KEY = (process.env.BRIDGE_INSTANCE_KEY || '').trim();
const NEXT_APP_BASE_URL = (process.env.NEXT_APP_BASE_URL || '').trim().replace(/\/$/, '');
const NEXT_APP_BRIDGE_URL =
  process.env.NEXT_APP_BRIDGE_URL ||
  (NEXT_APP_BASE_URL ? `${NEXT_APP_BASE_URL}/api/wa-bridge/incoming` : undefined);
const NEXT_APP_BRIDGE_STATE_URL =
  process.env.NEXT_APP_BRIDGE_STATE_URL ||
  (NEXT_APP_BASE_URL ? `${NEXT_APP_BASE_URL}/api/wa-bridge/state` : undefined);
const NEXT_APP_BRIDGE_CONTROL_URL =
  process.env.NEXT_APP_BRIDGE_CONTROL_URL ||
  (NEXT_APP_BASE_URL ? `${NEXT_APP_BASE_URL}/api/wa-bridge/control` : undefined);
const TEAM_ID = process.env.TEAM_ID || 'system';
const HTTP_TIMEOUT_MS = Number(process.env.BRIDGE_HTTP_TIMEOUT_MS || 30000);
const BRIDGE_AUTH_AUTO_RESET = String(process.env.BRIDGE_AUTH_AUTO_RESET || 'false') === 'true';
const BRIDGE_AUTH_RESET_401_THRESHOLD = Number(process.env.BRIDGE_AUTH_RESET_401_THRESHOLD || 5);
const BRIDGE_AUTH_RESET_WINDOW_MS = Number(process.env.BRIDGE_AUTH_RESET_WINDOW_MS || 300000);

const lockFilePath   = path.resolve(process.cwd(), '.bridge.lock');
const authStatePath  = path.resolve(process.cwd(), '.baileys_auth');

if (!BRIDGE_SHARED_SECRET || !NEXT_APP_BRIDGE_URL || !NEXT_APP_BRIDGE_STATE_URL || !NEXT_APP_BRIDGE_CONTROL_URL) {
  console.error('Missing BRIDGE_SHARED_SECRET or bridge URLs. Check bridge/.env');
  process.exit(1);
}

function bridgeHeaders(contentType = true) {
  const headers = {
    'x-bridge-secret': BRIDGE_SHARED_SECRET,
  };
  if (contentType) {
    headers['Content-Type'] = 'application/json';
  }
  if (BRIDGE_INSTANCE_KEY) {
    headers['x-bridge-instance-key'] = BRIDGE_INSTANCE_KEY;
  }
  return headers;
}

// ─── Runtime state ────────────────────────────────────────────────────────────

let activeClient         = null;
let clientReady          = false;
let reconnectTimer       = null;
let reconnectInProgress  = false;
let isShuttingDown       = false;
let heartbeatTimer       = null;
let heartbeatInFlight    = false;
let controlPollTimer     = null;
let controlPollInFlight  = false;
let readyStateWatchdog   = null;
let latestBridgeStatus   = 'starting';
let latestBridgeReason   = 'Initializing bridge session';
let latestLinkedPhone    = null;
let latestBridgeQrText   = null;

const botSentMessageIds    = new Set();
const seenIncomingMessageIds = new Set();
const missingNodeFallbackByPhone = new Map();
const lidToPnJid = new Map();
const auth401Events = [];

function shouldResetAuthOnLoggedOut() {
  if (!BRIDGE_AUTH_AUTO_RESET) return false;
  const now = Date.now();
  while (auth401Events.length && now - auth401Events[0] > BRIDGE_AUTH_RESET_WINDOW_MS) {
    auth401Events.shift();
  }
  auth401Events.push(now);
  return auth401Events.length >= BRIDGE_AUTH_RESET_401_THRESHOLD;
}

// ─── Process lock ─────────────────────────────────────────────────────────────

function acquireProcessLock() {
  const createLock = () => {
    const fd = fs.openSync(lockFilePath, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
  };
  const isPidAlive = (pidText) => {
    const pid = Number(pidText);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  try { createLock(); return; } catch (e) {
    if (!(e && typeof e === 'object' && e.code === 'EEXIST')) throw e;
  }
  let existingPid = '';
  try { existingPid = fs.readFileSync(lockFilePath, 'utf8').trim(); } catch {}
  if (!isPidAlive(existingPid)) {
    try { fs.rmSync(lockFilePath, { force: true }); createLock(); console.warn('Removed stale lock.'); return; }
    catch { console.error('Failed to recover stale lock.'); throw new Error('Lock conflict'); }
  }
  console.error(`Another bridge instance running (pid: ${existingPid}). Stop it first.`);
  process.exit(1);
}

function releaseProcessLock() {
  try { if (fs.existsSync(lockFilePath)) fs.rmSync(lockFilePath, { force: true }); } catch {}
}

// ─── Auth state ───────────────────────────────────────────────────────────────

function clearAuthState() {
  try {
    if (fs.existsSync(authStatePath)) {
      fs.rmSync(authStatePath, { recursive: true, force: true });
      console.warn('Cleared Baileys auth state. QR re-link required.');
    }
  } catch (err) {
    console.error('Failed to clear auth state:', err?.message);
  }
}

// ─── JID / phone utils ────────────────────────────────────────────────────────

function normalizePhoneFromJid(jid) {
  return (jid || '').split('@')[0].split(':')[0].trim();
}

function isDirectUserJid(jid) {
  return (
    typeof jid === 'string' &&
    (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us') || jid.endsWith('@lid'))
  );
}

function toDirectJid(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

function resolveIncomingAddress(message) {
  const key = message?.key || {};
  const remoteJid = typeof key.remoteJid === 'string' ? key.remoteJid : '';
  const remoteJidAlt = typeof key.remoteJidAlt === 'string' ? key.remoteJidAlt : '';
  const senderPn = typeof key.senderPn === 'string' ? key.senderPn : '';
  const primaryJid = remoteJid || remoteJidAlt;
  const skip =
    !primaryJid ||
    primaryJid === 'status@broadcast' ||
    primaryJid.endsWith('@g.us') ||
    primaryJid.endsWith('@broadcast') ||
    primaryJid.endsWith('@newsletter');
  if (skip) {
    return { valid: false, jid: '', outboundJid: '', phone: '' };
  }

  if (remoteJid.endsWith('@lid') && senderPn.endsWith('@s.whatsapp.net')) {
    lidToPnJid.set(remoteJid, senderPn);
    if (lidToPnJid.size > 5000) {
      const first = lidToPnJid.keys().next().value;
      if (first) lidToPnJid.delete(first);
    }
  }

  const pnLikeSender =
    senderPn &&
    (senderPn.endsWith('@s.whatsapp.net') || senderPn.endsWith('@c.us'));
  const pnLikeAlt =
    remoteJidAlt &&
    (remoteJidAlt.endsWith('@s.whatsapp.net') || remoteJidAlt.endsWith('@c.us'));
  const mappedPn = remoteJid.endsWith('@lid') ? lidToPnJid.get(remoteJid) || '' : '';
  const outboundJid = pnLikeSender
    ? senderPn
    : pnLikeAlt
    ? remoteJidAlt
    : mappedPn
    ? mappedPn
    : primaryJid;
  const phone = normalizePhoneFromJid(outboundJid || primaryJid);
  return { valid: true, jid: primaryJid, outboundJid, phone };
}

// ─── Message utils ────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getTextFromBaileysMessage(message) {
  const msg = message?.message;
  const normalized = msg ? normalizeMessageContent(msg) || msg : null;
  const directText = (
    normalized?.conversation ||
    normalized?.extendedTextMessage?.text ||
    normalized?.imageMessage?.caption ||
    normalized?.videoMessage?.caption ||
    normalized?.buttonsResponseMessage?.selectedDisplayText ||
    normalized?.buttonsResponseMessage?.selectedButtonId ||
    normalized?.interactiveResponseMessage?.body ||
    normalized?.interactiveResponseMessage?.nativeFlowResponseMessage?.name ||
    normalized?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    normalized?.listResponseMessage?.title ||
    normalized?.templateButtonReplyMessage?.selectedId ||
    normalized?.templateButtonReplyMessage?.selectedDisplayText ||
    ''
  ).trim();
  if (directText) return directText;

  const nativeFlowParams = normalized?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (typeof nativeFlowParams === 'string' && nativeFlowParams.trim()) {
    try {
      const parsed = JSON.parse(nativeFlowParams);
      const parsedText =
        parsed?.title ||
        parsed?.id ||
        parsed?.value ||
        parsed?.text ||
        parsed?.selection ||
        '';
      if (typeof parsedText === 'string' && parsedText.trim()) return parsedText.trim();
    } catch {}
    return nativeFlowParams.trim();
  }

  const queue = [normalized, message];
  const seen = new Set();
  const wantedKeys = new Set([
    'text',
    'conversation',
    'caption',
    'title',
    'selectedDisplayText',
    'selectedButtonId',
    'selectedId',
    'selectedRowId',
    'body',
    'description',
    'contentText',
  ]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const [key, value] of Object.entries(current)) {
      if (typeof value === 'string') {
        if (wantedKeys.has(key) && value.trim()) return value.trim();
        continue;
      }
      if (value && typeof value === 'object') queue.push(value);
    }
  }

  return '';
}

function isIgnorableSystemEvent(message) {
  if (!message || typeof message !== 'object') return true;
  const hasMessagePayload = Boolean(message.message) && Object.keys(message.message || {}).length > 0;
  if (hasMessagePayload) return false;

  const hasStubType = Number.isInteger(message?.messageStubType);
  const hasStubParams =
    Array.isArray(message?.messageStubParameters) &&
    message.messageStubParameters.length > 0;
  const isBroadcastFlag = Boolean(message?.broadcast);

  return hasStubType || hasStubParams || isBroadcastFlag;
}

function isMessageAbsentFromNodeStub(message) {
  if (!message || typeof message !== 'object') return false;
  const stubType = Number(message?.messageStubType || 0);
  if (stubType !== 2) return false;
  const params = Array.isArray(message?.messageStubParameters)
    ? message.messageStubParameters.map((v) => String(v || '').toLowerCase())
    : [];
  return params.some((v) => v.includes('message absent from node'));
}

function shouldSendMissingNodeFallback(phone) {
  const key = String(phone || '').trim();
  if (!key) return false;
  const now = Date.now();
  const last = missingNodeFallbackByPhone.get(key) || 0;
  if (now - last < 120000) return false;
  missingNodeFallbackByPhone.set(key, now);
  if (missingNodeFallbackByPhone.size > 2000) {
    const firstKey = missingNodeFallbackByPhone.keys().next().value;
    if (firstKey) missingNodeFallbackByPhone.delete(firstKey);
  }
  return true;
}

function rememberBotMessageIdById(id) {
  if (!id) return;
  botSentMessageIds.add(id);
  if (botSentMessageIds.size > 2000) {
    const [first] = botSentMessageIds;
    if (first) botSentMessageIds.delete(first);
  }
}

function rememberIncomingId(id) {
  if (!id) return;
  seenIncomingMessageIds.add(id);
  if (seenIncomingMessageIds.size > 5000) {
    const [first] = seenIncomingMessageIds;
    if (first) seenIncomingMessageIds.delete(first);
  }
}

function buildTemplateText(message, buttonLabels) {
  if (!buttonLabels.length) return message;
  const options = buttonLabels.map((label, idx) => `${idx + 1}. ${label}`).join('\n');
  return `${message}\n\nPlease choose one option:\n${options}`;
}

// ─── Bridge state reporting ───────────────────────────────────────────────────

function setBridgeSnapshot(status, reason = null, linkedPhone = null) {
  console.log(`[state] ${latestBridgeStatus} → ${status}`);
  latestBridgeStatus = status || latestBridgeStatus;
  latestBridgeReason = reason;
  if (linkedPhone !== undefined) latestLinkedPhone = linkedPhone;
}

async function reportBridgeState({ status, qrText = undefined, reason = null, linkedPhone = null }) {
  if (status === 'connected') {
    latestBridgeQrText = null;
  } else if (qrText !== undefined) {
    latestBridgeQrText = qrText;
  }
  const outgoingQrText = qrText === undefined ? latestBridgeQrText : qrText;
  setBridgeSnapshot(status, reason, linkedPhone);
  const payload = { teamId: TEAM_ID, status, qrText: outgoingQrText, reason, linkedPhone, heartbeatAt: new Date().toISOString() };
  const headers = bridgeHeaders(true);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await axios.post(NEXT_APP_BRIDGE_STATE_URL, payload, { headers, timeout: HTTP_TIMEOUT_MS });
      return;
    } catch (err) {
      if (attempt === 3) console.error(`Failed to report bridge state (${status}) after 3 attempts:`, err?.message);
      else await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// ─── Send message (non-blocking typing indicator) ─────────────────────────────

async function sendTypingAndText(sock, jid, text) {
  (async () => {
    try { await sock.sendPresenceUpdate('composing', jid); } catch {}
  })();

  await sleep(900);

  // Avoid stale device cache for LID/PN mixed threads to reduce "Waiting for this message".
  const sent = await sock.sendMessage(jid, { text }, { useUserDevicesCache: false });
  if (sent?.key?.id) rememberBotMessageIdById(sent.key.id);

  (async () => {
    try { await sock.sendPresenceUpdate('paused', jid); } catch {}
  })();

  return sent;
}

// ─── AI call ──────────────────────────────────────────────────────────────────

async function askAiForReply(payload) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.post(NEXT_APP_BRIDGE_URL, payload, {
        headers: bridgeHeaders(true),
        timeout: Math.max(HTTP_TIMEOUT_MS, 30000),
      });
      return response.data;
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(600 * attempt);
    }
  }
  return null;
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────

async function syncStatusFromClientState() {
  if (!activeClient) return;
  if (clientReady && latestBridgeStatus !== 'connected') {
    const linkedPhone = activeClient?.user?.id
      ? normalizePhoneFromJid(activeClient.user.id)
      : latestLinkedPhone;
    await reportBridgeState({ status: 'connected', qrText: null, reason: null, linkedPhone });
  }
}

function startHeartbeatLoop() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(async () => {
    if (isShuttingDown || heartbeatInFlight) return;
    heartbeatInFlight = true;
    try {
      await syncStatusFromClientState();
      await reportBridgeState({ status: latestBridgeStatus, reason: latestBridgeReason, linkedPhone: latestLinkedPhone });
    } finally {
      heartbeatInFlight = false;
    }
  }, 30000);
}

function stopHeartbeatLoop() {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// ─── Control commands ─────────────────────────────────────────────────────────

async function ackCommand(commandId, status, message = null) {
  try {
    await axios.post(
      NEXT_APP_BRIDGE_CONTROL_URL,
      { commandId, status, message },
      { headers: bridgeHeaders(true), timeout: HTTP_TIMEOUT_MS }
    );
  } catch (err) {
    console.error(`Failed to ack command ${commandId}:`, err?.message);
  }
}

async function pollControlCommands() {
  if (controlPollInFlight || isShuttingDown) return;
  controlPollInFlight = true;
  try {
    const response = await axios.get(NEXT_APP_BRIDGE_CONTROL_URL, {
      headers: bridgeHeaders(false),
      params: { teamId: TEAM_ID },
      timeout: HTTP_TIMEOUT_MS,
    });
    const command = response?.data?.command;
    if (!command?.id || !command?.action) return;

    const action = String(command.action).toLowerCase();
    console.log(`Bridge command: ${action} (${command.id})`);

    if (action === 'restart') {
      if (latestBridgeStatus === 'connected') {
        await ackCommand(command.id, 'completed', 'Restart skipped: bridge already connected.');
        return;
      }
      await ackCommand(command.id, 'completed', 'Restart accepted.');
      await requestBridgeReconnect('Restart requested from dashboard', false);
      return;
    }
    if (action === 'relink') {
      if (latestBridgeStatus === 'connected') {
        await ackCommand(command.id, 'failed', 'Relink blocked: bridge is already connected.');
        return;
      }
      await ackCommand(command.id, 'completed', 'Relink accepted. New QR will appear.');
      await requestBridgeReconnect('Relink requested from dashboard', true);
      return;
    }
    if (action === 'send_text') {
      const payload = command.payload || {};
      const phone   = String(payload.phone || '').replace(/[^\d]/g, '');
      const message = String(payload.message || '').trim();
      if (!phone || !message) { await ackCommand(command.id, 'failed', 'send_text missing phone/message'); return; }
      if (!activeClient || latestBridgeStatus !== 'connected') { await ackCommand(command.id, 'failed', 'Bridge not connected'); return; }
      try {
        await sendTypingAndText(activeClient, toDirectJid(phone), message);
        await ackCommand(command.id, 'completed', `Sent to ${phone}`);
      } catch (err) {
        await ackCommand(command.id, 'failed', err?.message || 'Send failed');
      }
      return;
    }
    if (action === 'send_template') {
      const payload      = command.payload || {};
      const phone        = String(payload.phone || '').replace(/[^\d]/g, '');
      const message      = String(payload.message || '').trim();
      const buttonLabels = Array.isArray(payload.buttons)
        ? payload.buttons.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 3)
        : [];
      if (!phone || !message) { await ackCommand(command.id, 'failed', 'send_template missing phone/message'); return; }
      if (!activeClient || latestBridgeStatus !== 'connected') { await ackCommand(command.id, 'failed', 'Bridge not connected'); return; }
      try {
        await sendTypingAndText(activeClient, toDirectJid(phone), buildTemplateText(message, buttonLabels));
        await ackCommand(command.id, 'completed', `Template sent to ${phone}`);
      } catch (err) {
        await ackCommand(command.id, 'failed', err?.message || 'Send failed');
      }
      return;
    }
    await ackCommand(command.id, 'failed', `Unsupported action: ${action}`);
  } catch (err) {
    console.error('Control poll failed:', err?.message);
  } finally {
    controlPollInFlight = false;
  }
}

function startControlPolling() {
  if (controlPollTimer) return;
  controlPollTimer = setInterval(() => { pollControlCommands(); }, 5000);
}

function stopControlPolling() {
  if (!controlPollTimer) return;
  clearInterval(controlPollTimer);
  controlPollTimer = null;
}

// ─── Reconnect logic ──────────────────────────────────────────────────────────

function clearReadyStateWatchdog() {
  if (!readyStateWatchdog) return;
  clearTimeout(readyStateWatchdog);
  readyStateWatchdog = null;
}

function scheduleReconnect(delayMs = 1500) {
  if (isShuttingDown || reconnectInProgress || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectInProgress = true;
    startBridge()
      .catch((err) => console.error('Failed to restart bridge:', err))
      .finally(() => { reconnectInProgress = false; });
  }, delayMs);
}

async function requestBridgeReconnect(reason, forceRelink = false) {
  if (isShuttingDown) return;
  if (forceRelink) clearAuthState();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  await reportBridgeState({ status: 'starting', reason, linkedPhone: latestLinkedPhone });
  if (activeClient) {
    try { activeClient.end(undefined); } catch {}
    activeClient = null;
  }
  scheduleReconnect(900);
}

// ─── Main bridge startup ──────────────────────────────────────────────────────

async function startBridge() {
  if (isShuttingDown) return;
  clientReady = false;

  await reportBridgeState({
    status: latestBridgeStatus === 'qr_required' ? 'qr_required' : 'starting',
    reason: 'Initializing Baileys bridge',
  });

  if (activeClient) {
    try { activeClient.end(undefined); } catch {}
    activeClient = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(authStatePath);

  let version;
  try {
    const result = await fetchLatestBaileysVersion();
    version = result.version;
    console.log(`Using WhatsApp Web version: ${version.join('.')}`);
  } catch {
    version = [2, 3000, 1021994168];
    console.warn('Could not fetch latest WA version, using fallback.');
  }

  const logger = pino({ level: 'silent' });

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    browser: ['TravAI Bridge', 'Chrome', '1.0.0'],
    connectTimeoutMs: 30_000,
    defaultQueryTimeoutMs: 30_000,
    retryRequestDelayMs: 2_000,
    keepAliveIntervalMs: 15_000,
    markOnlineOnConnect: false,
  });

  activeClient = sock;

  sock.ev.on('creds.update', saveCreds);

  // 90-second watchdog for initial connection (QR or session restore)
  const initWatchdog = setTimeout(() => {
    if (isShuttingDown || clientReady || activeClient !== sock) return;
    console.warn('Bridge init timeout (90s). Reconnecting without clearing auth.');
    void requestBridgeReconnect('Bridge initialization timeout', false);
  }, 90_000);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      clearTimeout(initWatchdog);
      console.log('\nScan this QR in WhatsApp → Linked Devices:\n');
      qrcode.generate(qr, { small: true });
      await reportBridgeState({
        status: 'qr_required',
        qrText: qr,
        reason: 'QR generated. Scan to link WhatsApp device.',
      });

      // 5-minute watchdog after QR shown — regenerate without clearing auth
      clearReadyStateWatchdog();
      readyStateWatchdog = setTimeout(() => {
        if (isShuttingDown || clientReady || activeClient !== sock) return;
        console.warn('QR not scanned in 5 min. Regenerating QR.');
        void requestBridgeReconnect('QR scan timeout', false);
      }, 300_000);
    }

    if (connection === 'open') {
      clearTimeout(initWatchdog);
      clearReadyStateWatchdog();
      clientReady = true;
      const linkedPhone = sock.user?.id
        ? normalizePhoneFromJid(sock.user.id)
        : latestLinkedPhone;
      console.log(`Baileys bridge connected and ready (${linkedPhone || 'unknown'}).`);
      await reportBridgeState({ status: 'connected', qrText: null, reason: null, linkedPhone });
    }

    if (connection === 'close') {
      clearTimeout(initWatchdog);
      clearReadyStateWatchdog();
      clientReady = false;

      const statusCode  = lastDisconnect?.error?.output?.statusCode;
      const loggedOut   = statusCode === DisconnectReason.loggedOut;
      const reason      = `Disconnected (code: ${statusCode ?? 'unknown'})`;
      console.warn(reason + (loggedOut ? ' — session logged out' : ''));

      await reportBridgeState({
        status: 'disconnected',
        qrText: null,
        reason,
        linkedPhone: latestLinkedPhone,
      });

      if (loggedOut) {
        if (shouldResetAuthOnLoggedOut()) {
          console.warn(
            `Auth reset threshold reached (${BRIDGE_AUTH_RESET_401_THRESHOLD} within ${BRIDGE_AUTH_RESET_WINDOW_MS}ms). Clearing auth state.`
          );
          clearAuthState();
        } else {
          console.warn(
            'Logged out signal received, but auth auto-reset is disabled or threshold not reached. Keeping auth state and retrying reconnect.'
          );
        }
      }

      if (!isShuttingDown && activeClient === sock) {
        scheduleReconnect(loggedOut ? 900 : 1500);
      }
    }
  });

  // ─── Incoming messages ───────────────────────────────────────────────────

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    const thirtyMinutesAgo = Math.floor(Date.now() / 1000) - 1800;

    for (const message of messages) {
      // Process real-time messages (notify) OR recent history on reconnect.
      if (type !== 'notify') {
        const ts = Number(message.messageTimestamp || 0);
        if (ts < thirtyMinutesAgo) continue;
      }
      const resolved  = resolveIncomingAddress(message);
      const jid       = resolved.jid;
      const outboundJid = resolved.outboundJid || jid;
      const isFromMe  = Boolean(message.key.fromMe);
      const messageId = message.key.id || 'unknown';

      if (!resolved.valid || !isDirectUserJid(outboundJid)) continue;

      const text     = getTextFromBaileysMessage(message);
      const phone    = resolved.phone || normalizePhoneFromJid(jid);
      const pushName = message.pushName || null;

      if (isFromMe) {
        if (botSentMessageIds.has(messageId)) {
          botSentMessageIds.delete(messageId);
          continue;
        }
        if (!text) continue;
        try {
          await askAiForReply({ from: phone, name: null, message: text, messageId, teamId: TEAM_ID, eventType: 'staff_outgoing' });
          console.log(`Recorded staff outgoing for ${phone}`);
        } catch (err) {
          console.error('Failed to record staff outgoing:', err?.message);
        }
        continue;
      }

      if (seenIncomingMessageIds.has(messageId)) continue;
      rememberIncomingId(messageId);
      if (!text) {
        if (isMessageAbsentFromNodeStub(message) && shouldSendMissingNodeFallback(phone)) {
          try {
            const ai = await askAiForReply({
              from: phone,
              name: pushName,
              message: 'hi',
              messageId: `${messageId}:stub`,
              teamId: TEAM_ID,
              eventType: 'incoming_message',
            });
            if (ai?.shouldReply !== false && ai?.reply?.trim()) {
              await sendTypingAndText(sock, outboundJid, ai.reply.trim());
              console.log(`Fallback replied to ${phone} for message-absent stub ${messageId}`);
            } else {
              console.warn(`No fallback AI reply for stub id=${messageId}`);
            }
          } catch (err) {
            console.error(`Fallback reply failed for stub id=${messageId}:`, err?.message);
          }
        }
        if (!isIgnorableSystemEvent(message)) {
          const msgKeys = Object.keys(message?.message || {});
          console.log(`Skipped non-text message id=${messageId} typeKeys=${msgKeys.join(',') || 'none'}`);
        }
        continue;
      }

      try {
        const ai = await askAiForReply({
          from: phone,
          name: pushName,
          message: text,
          messageId,
          teamId: TEAM_ID,
          eventType: 'incoming_message',
        });

        if (ai?.shouldReply === false) {
          console.log(`Reply suppressed for ${phone} (${ai?.suppressed ?? 'no_reason'})`);
          continue;
        }
        if (!ai?.reply?.trim()) {
          console.warn(`No AI reply for message id=${messageId}`);
          continue;
        }

        await sendTypingAndText(sock, outboundJid, ai.reply.trim());
        console.log(`Replied to ${phone}: ${ai.reply.slice(0, 80)}`);
      } catch (err) {
        console.error(`Failed to process message ${messageId}:`, err?.message);
      }
    }
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

acquireProcessLock();
startHeartbeatLoop();
startControlPolling();

startBridge().catch((err) => {
  console.error('Bridge failed to start:', err);
  void reportBridgeState({ status: 'error', qrText: null, reason: err?.message || String(err) });
  scheduleReconnect(4500);
});

process.on('SIGINT', () => {
  isShuttingDown = true;
  stopHeartbeatLoop();
  stopControlPolling();
  releaseProcessLock();
  process.exit(0);
});

process.on('SIGTERM', () => {
  isShuttingDown = true;
  stopHeartbeatLoop();
  stopControlPolling();
  releaseProcessLock();
  process.exit(0);
});

process.on('exit', () => {
  stopHeartbeatLoop();
  stopControlPolling();
  releaseProcessLock();
});
