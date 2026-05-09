import dotenv from 'dotenv';
import axios from 'axios';
import qrcode from 'qrcode-terminal';
import whatsapp from 'whatsapp-web.js';
import fs from 'node:fs';
import path from 'node:path';

const { Client, LocalAuth } = whatsapp;

dotenv.config();

const BRIDGE_SHARED_SECRET = process.env.BRIDGE_SHARED_SECRET;
const NEXT_APP_BASE_URL = (process.env.NEXT_APP_BASE_URL || '')
  .trim()
  .replace(/\/$/, '');
const NEXT_APP_BRIDGE_URL =
  process.env.NEXT_APP_BRIDGE_URL ||
  (NEXT_APP_BASE_URL ? `${NEXT_APP_BASE_URL}/api/wa-bridge/incoming` : undefined);
const NEXT_APP_BRIDGE_STATE_URL =
  process.env.NEXT_APP_BRIDGE_STATE_URL ||
  (NEXT_APP_BASE_URL
    ? `${NEXT_APP_BASE_URL}/api/wa-bridge/state`
    : NEXT_APP_BRIDGE_URL?.replace(/\/incoming\/?$/, '/state'));
const NEXT_APP_BRIDGE_CONTROL_URL =
  process.env.NEXT_APP_BRIDGE_CONTROL_URL ||
  (NEXT_APP_BASE_URL
    ? `${NEXT_APP_BASE_URL}/api/wa-bridge/control`
    : NEXT_APP_BRIDGE_URL?.replace(/\/incoming\/?$/, '/control'));
const TEAM_ID = process.env.TEAM_ID || 'system';
const HTTP_TIMEOUT_MS = Number(process.env.BRIDGE_HTTP_TIMEOUT_MS || 30000);
const WA_WEB_VERSION = (process.env.WA_WEB_VERSION || '').trim();
const lockFilePath = path.resolve(process.cwd(), '.bridge.lock');
const authStatePath = path.resolve(process.cwd(), '.wwebjs_auth');
let reconnectTimer = null;
let reconnectInProgress = false;
let activeClient = null;
let isShuttingDown = false;
let heartbeatTimer = null;
let heartbeatInFlight = false;
let controlPollTimer = null;
let controlPollInFlight = false;
let latestBridgeStatus = 'starting';
let latestBridgeReason = 'Initializing bridge session';
let latestLinkedPhone = null;
let latestBridgeQrText = null;
let readyStateWatchdog = null;
const botSentMessageIds = new Set();
const seenIncomingMessageIds = new Set();

if (
  !BRIDGE_SHARED_SECRET ||
  !NEXT_APP_BRIDGE_URL ||
  !NEXT_APP_BRIDGE_STATE_URL ||
  !NEXT_APP_BRIDGE_CONTROL_URL
) {
  console.error(
    'Missing BRIDGE_SHARED_SECRET and bridge URLs in bridge/.env. Set NEXT_APP_BASE_URL or explicit NEXT_APP_BRIDGE_URL/NEXT_APP_BRIDGE_STATE_URL/NEXT_APP_BRIDGE_CONTROL_URL.'
  );
  process.exit(1);
}

function acquireProcessLock() {
  const createLock = () => {
    const fd = fs.openSync(lockFilePath, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
  };

  const isPidAlive = (pidText) => {
    const pid = Number(pidText);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  try {
    createLock();
    return;
  } catch (error) {
    if (!(error && typeof error === 'object' && error.code === 'EEXIST')) {
      throw error;
    }
  }

  // Lock file already exists. If stale, clear and continue.
  let existingPid = '';
  try {
    existingPid = fs.readFileSync(lockFilePath, 'utf8').trim();
  } catch {
    existingPid = '';
  }

  if (!isPidAlive(existingPid)) {
    try {
      fs.rmSync(lockFilePath, { force: true });
      createLock();
      console.warn('Removed stale bridge lock file and acquired new lock.');
      return;
    } catch (error) {
      console.error('Failed to recover stale bridge lock file.');
      throw error;
    }
  }

  console.error(
    `Another bridge instance is already running (pid: ${existingPid || 'unknown'}). Stop it before starting a new one.`
  );
  process.exit(1);
}

function releaseProcessLock() {
  try {
    if (fs.existsSync(lockFilePath)) {
      fs.rmSync(lockFilePath, { force: true });
    }
  } catch {
    // Best effort cleanup.
  }
}

function clearAuthState() {
  try {
    if (fs.existsSync(authStatePath)) {
      fs.rmSync(authStatePath, { recursive: true, force: true });
      console.warn('Cleared stale WhatsApp auth state. QR re-link required.');
    }
  } catch (error) {
    console.error('Failed to clear auth state:', error?.message || String(error));
  }
}

function resolveLinkedPhone(rawUserId) {
  return normalizePhoneFromJid(rawUserId);
}

function normalizePhoneFromJid(jid) {
  return (jid || '')
    .replace('@c.us', '')
    .replace('@s.whatsapp.net', '')
    .replace('@lid', '')
    .replace('@pn', '')
    .trim();
}

function isDirectUserJid(jid) {
  return (
    typeof jid === 'string' &&
    (jid.endsWith('@c.us') ||
      jid.endsWith('@s.whatsapp.net') ||
      jid.endsWith('@lid') ||
      jid.endsWith('@pn'))
  );
}

function toDirectJid(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  return digits ? `${digits}@c.us` : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setBridgeSnapshot(status, reason = null, linkedPhone = null) {
  latestBridgeStatus = status || latestBridgeStatus;
  latestBridgeReason = reason;
  if (linkedPhone !== undefined) {
    latestLinkedPhone = linkedPhone;
  }
}

function extractMessageId(message) {
  const idObj = message?.id;
  if (!idObj) return '';
  if (typeof idObj._serialized === 'string' && idObj._serialized.trim()) {
    return idObj._serialized.trim();
  }
  if (typeof idObj.id === 'string' && idObj.id.trim()) {
    return idObj.id.trim();
  }
  return '';
}

function rememberBotMessageId(message) {
  const id = extractMessageId(message);
  if (!id) {
    return;
  }
  rememberBotMessageIdById(id);
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

function getTextFromMessage(message) {
  const body = String(message?.body || '').trim();
  if (body) return body;
  const caption = String(message?._data?.caption || '').trim();
  if (caption) return caption;
  return '';
}

async function sendTypingAndText(client, chatId, text) {
  let chat = null;
  try {
    chat = await client.getChatById(chatId);
    await chat.sendStateTyping();
  } catch {
    // best-effort presence
  }
  const dynamicDelay = Math.max(
    800,
    Math.min(2500, Math.floor((text?.length || 0) * 15))
  );
  await sleep(dynamicDelay);
  const sent = await client.sendMessage(chatId, text);
  rememberBotMessageId(sent);
  try {
    if (chat) {
      await chat.clearState();
    }
  } catch {
    // best-effort presence
  }
  return sent;
}

function buildTemplateText(message, buttonLabels) {
  if (!buttonLabels.length) return message;
  const options = buttonLabels.map((label, idx) => `${idx + 1}. ${label}`).join('\n');
  return `${message}\n\nPlease choose one option:\n${options}`;
}

async function askAiForReply(payload) {
  const response = await axios.post(NEXT_APP_BRIDGE_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      'x-bridge-secret': BRIDGE_SHARED_SECRET,
    },
    timeout: Math.max(HTTP_TIMEOUT_MS, 30000),
  });
  return response.data;
}

async function reportBridgeState({
  status,
  qrText = undefined,
  reason = null,
  linkedPhone = null,
}) {
  if (status === 'connected') {
    latestBridgeQrText = null;
  } else if (qrText !== undefined) {
    latestBridgeQrText = qrText;
  }

  const outgoingQrText =
    qrText === undefined ? latestBridgeQrText : qrText;

  setBridgeSnapshot(status, reason, linkedPhone);
  try {
    await axios.post(
      NEXT_APP_BRIDGE_STATE_URL,
      {
        teamId: TEAM_ID,
        status,
        qrText: outgoingQrText,
        reason,
        linkedPhone,
        heartbeatAt: new Date().toISOString(),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-bridge-secret': BRIDGE_SHARED_SECRET,
        },
        timeout: HTTP_TIMEOUT_MS,
      }
    );
  } catch (error) {
    const msg = error?.response?.data
      ? JSON.stringify(error.response.data)
      : error?.message || String(error);
    console.error(`Failed to report bridge state (${status}): ${msg}`);
  }
}

async function syncStatusFromClientState() {
  if (!activeClient || typeof activeClient.getState !== 'function') return;
  try {
    const rawState = await activeClient.getState();
    const state = String(rawState || '').toUpperCase();

    if (state === 'CONNECTED') {
      const linkedPhone = resolveLinkedPhone(activeClient?.info?.wid?._serialized || '');
      if (latestBridgeStatus !== 'connected') {
        await reportBridgeState({
          status: 'connected',
          qrText: null,
          reason: null,
          linkedPhone: linkedPhone || latestLinkedPhone,
        });
      }
      return;
    }

    if (state === 'UNPAIRED' || state === 'UNPAIRED_IDLE') {
      if (latestBridgeStatus !== 'qr_required') {
        await reportBridgeState({
          status: 'qr_required',
          reason: 'Session unpaired. Scan QR to relink WhatsApp device.',
          linkedPhone: latestLinkedPhone,
        });
      }
    }
  } catch {
    // best-effort state probe
  }
}

function startHeartbeatLoop() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(async () => {
    if (isShuttingDown) return;
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    try {
      await syncStatusFromClientState();
      await reportBridgeState({
        status: latestBridgeStatus,
        reason: latestBridgeReason,
        linkedPhone: latestLinkedPhone,
      });
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

async function ackCommand(commandId, status, message = null) {
  try {
    await axios.post(
      NEXT_APP_BRIDGE_CONTROL_URL,
      { commandId, status, message },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-bridge-secret': BRIDGE_SHARED_SECRET,
        },
        timeout: HTTP_TIMEOUT_MS,
      }
    );
  } catch (error) {
    const msg = error?.response?.data
      ? JSON.stringify(error.response.data)
      : error?.message || String(error);
    console.error(`Failed to ack bridge command ${commandId}: ${msg}`);
  }
}

async function requestBridgeReconnect(reason, forceRelink = false) {
  if (isShuttingDown) return;
  if (forceRelink) {
    clearAuthState();
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  await reportBridgeState({
    status: 'starting',
    reason,
    linkedPhone: latestLinkedPhone,
  });

  if (activeClient) {
    try {
      await activeClient.destroy();
    } catch {
      // Best effort shutdown.
    }
    activeClient = null;
  }

  scheduleReconnect(900);
}

async function pollControlCommands() {
  if (controlPollInFlight || isShuttingDown) return;
  controlPollInFlight = true;
  try {
    const response = await axios.get(NEXT_APP_BRIDGE_CONTROL_URL, {
      headers: {
        'x-bridge-secret': BRIDGE_SHARED_SECRET,
      },
      params: { teamId: TEAM_ID },
      timeout: HTTP_TIMEOUT_MS,
    });
    const command = response?.data?.command;
    if (!command || !command.id || !command.action) {
      return;
    }

    const action = String(command.action).toLowerCase();
    console.log(`Received bridge command: ${action} (${command.id})`);

    if (action === 'restart') {
      await ackCommand(command.id, 'completed', 'Bridge reconnect accepted.');
      await requestBridgeReconnect('Restart requested from dashboard', false);
      return;
    }

    if (action === 'relink') {
      await ackCommand(
        command.id,
        'completed',
        'Relink requested. Bridge will reconnect and show QR.'
      );
      await requestBridgeReconnect('Relink requested from dashboard', true);
      return;
    }

    if (action === 'send_text') {
      const payload = command.payload || {};
      const phone = String(payload.phone || '').replace(/[^\d]/g, '');
      const message = String(payload.message || '').trim();
      if (!phone || !message) {
        await ackCommand(command.id, 'failed', 'send_text missing phone/message');
        return;
      }
      if (!activeClient || latestBridgeStatus !== 'connected') {
        await ackCommand(command.id, 'failed', 'Bridge is not connected');
        return;
      }

      const jid = toDirectJid(phone);
      try {
        await sendTypingAndText(activeClient, jid, message);
        await ackCommand(command.id, 'completed', `Sent message to ${phone}`);
        console.log(`Bridge sent dashboard message to ${phone}: ${message.slice(0, 80)}`);
      } catch (sendError) {
        await ackCommand(
          command.id,
          'failed',
          sendError?.message || 'Failed to send message'
        );
      }
      return;
    }

    if (action === 'send_template') {
      const payload = command.payload || {};
      const phone = String(payload.phone || '').replace(/[^\d]/g, '');
      const message = String(payload.message || '').trim();
      const buttonLabels = Array.isArray(payload.buttons)
        ? payload.buttons
            .map((v) => String(v || '').trim())
            .filter(Boolean)
            .slice(0, 3)
        : [];

      if (!phone || !message) {
        await ackCommand(command.id, 'failed', 'send_template missing phone/message');
        return;
      }
      if (!activeClient || latestBridgeStatus !== 'connected') {
        await ackCommand(command.id, 'failed', 'Bridge is not connected');
        return;
      }

      const jid = toDirectJid(phone);
      try {
        const templateText = buildTemplateText(message, buttonLabels);
        await sendTypingAndText(activeClient, jid, templateText);
        await ackCommand(command.id, 'completed', `Sent template to ${phone}`);
        console.log(
          `Bridge sent template as text to ${phone}: ${message.slice(0, 80)} (options=${buttonLabels.length})`
        );
      } catch (sendError) {
        await ackCommand(
          command.id,
          'failed',
          sendError?.message || 'Failed to send template'
        );
      }
      return;
    }

    await ackCommand(command.id, 'failed', `Unsupported action: ${action}`);
  } catch (error) {
    const msg = error?.response?.data
      ? JSON.stringify(error.response.data)
      : error?.message || String(error);
    console.error(`Bridge control poll failed: ${msg}`);
  } finally {
    controlPollInFlight = false;
  }
}

function startControlPolling() {
  if (controlPollTimer) return;
  controlPollTimer = setInterval(() => {
    pollControlCommands();
  }, 5000);
}

function stopControlPolling() {
  if (!controlPollTimer) return;
  clearInterval(controlPollTimer);
  controlPollTimer = null;
}

function clearReadyStateWatchdog() {
  if (!readyStateWatchdog) return;
  clearTimeout(readyStateWatchdog);
  readyStateWatchdog = null;
}

function scheduleReconnect(delayMs = 1500) {
  if (isShuttingDown) {
    return;
  }
  if (reconnectInProgress || reconnectTimer) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectInProgress = true;
    startBridge()
      .catch((err) => {
        console.error('Failed to restart bridge:', err);
      })
      .finally(() => {
        reconnectInProgress = false;
      });
  }, delayMs);
}

async function startBridge() {
  if (isShuttingDown) {
    return;
  }

  await reportBridgeState({
    status: latestBridgeStatus === 'qr_required' ? 'qr_required' : 'starting',
    reason: 'Initializing bridge session',
  });

  if (activeClient) {
    try {
      await activeClient.destroy();
    } catch {
      // best effort
    }
    activeClient = null;
  }

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: authStatePath }),
    ...(WA_WEB_VERSION ? { webVersion: WA_WEB_VERSION } : {}),
    webVersionCache: {
      type: 'none',
    },
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-gpu',
        '--disable-software-rasterizer',
      ],
    },
  });
  activeClient = client;
  let clientReady = false;

  client.on('qr', async (qrText) => {
    console.log('\nScan this QR in WhatsApp (Linked Devices):\n');
    qrcode.generate(qrText, { small: true });
    await reportBridgeState({
      status: 'qr_required',
      qrText,
      reason: 'QR generated. Scan to relink WhatsApp device.',
    });
  });

  client.on('authenticated', async () => {
    clearReadyStateWatchdog();
    await reportBridgeState({
      status: latestBridgeStatus === 'qr_required' ? 'qr_required' : 'starting',
      reason: 'Authenticated. Waiting for ready state.',
      linkedPhone: latestLinkedPhone,
    });

    readyStateWatchdog = setTimeout(() => {
      if (isShuttingDown || clientReady || activeClient !== client) return;
      console.warn(
        'Authenticated but ready event did not arrive in time. Forcing re-link.'
      );
      void (async () => {
        await reportBridgeState({
          status: 'qr_required',
          reason: 'Session stuck before ready. Regenerating QR.',
          linkedPhone: latestLinkedPhone,
        });
        await requestBridgeReconnect(
          'Ready timeout after authentication',
          true
        );
      })();
    }, 300000);
  });

  client.on('ready', async () => {
    clientReady = true;
    clearReadyStateWatchdog();
    const linkedPhone = resolveLinkedPhone(client?.info?.wid?._serialized || '');
    console.log(`whatsapp-web.js bridge connected and ready (${linkedPhone || 'unknown'}).`);
    await reportBridgeState({
      status: 'connected',
      qrText: null,
      reason: null,
      linkedPhone: linkedPhone || latestLinkedPhone,
    });
  });

  client.on('auth_failure', async (message) => {
    clientReady = false;
    clearReadyStateWatchdog();
    const reason = String(message || 'Authentication failed');
    console.error(`Auth failure: ${reason}`);
    await reportBridgeState({
      status: 'qr_required',
      qrText: null,
      reason,
    });
    clearAuthState();
    scheduleReconnect(1800);
  });

  client.on('change_state', async (state) => {
    const next = String(state || '').toUpperCase();
    console.log(`WA state changed: ${next || 'UNKNOWN'}`);
    if (next === 'CONNECTED' && !clientReady) {
      clientReady = true;
      clearReadyStateWatchdog();
      const linkedPhone = resolveLinkedPhone(client?.info?.wid?._serialized || '');
      await reportBridgeState({
        status: 'connected',
        qrText: null,
        reason: null,
        linkedPhone: linkedPhone || latestLinkedPhone,
      });
    }
  });

  client.on('disconnected', async (reason) => {
    if (isShuttingDown) return;
    clientReady = false;
    clearReadyStateWatchdog();
    const reasonText = String(reason || 'unknown');
    console.warn(`Bridge disconnected: ${reasonText}`);
    await reportBridgeState({
      status: 'disconnected',
      qrText: null,
      reason: `Disconnected: ${reasonText}`,
      linkedPhone: latestLinkedPhone,
    });
    scheduleReconnect(1500);
  });

  client.on('message_create', async (message) => {
    const chatId = String(message?.from || message?.to || '').trim();
    const isFromMe = Boolean(message?.fromMe);
    const messageId = extractMessageId(message) || 'unknown';

    if (!isDirectUserJid(chatId) || chatId === 'status@broadcast') {
      return;
    }

    if (isFromMe) {
      if (botSentMessageIds.has(messageId)) {
        botSentMessageIds.delete(messageId);
        return;
      }

      const ownText = getTextFromMessage(message);
      if (!ownText) return;
      const phone = normalizePhoneFromJid(chatId);

      try {
        await askAiForReply({
          from: phone,
          name: null,
          message: ownText,
          messageId,
          timestamp: message?.timestamp ? String(message.timestamp) : null,
          teamId: TEAM_ID,
          eventType: 'staff_outgoing',
        });
        console.log(`Recorded staff outgoing message for ${phone}`);
      } catch (error) {
        const msgText =
          error?.response?.data
            ? JSON.stringify(error.response.data)
            : error?.message || String(error);
        console.error(`Failed to record staff outgoing message: ${msgText}`);
      }
      return;
    }

    if (seenIncomingMessageIds.has(messageId)) {
      return;
    }
    rememberIncomingId(messageId);

    const text = getTextFromMessage(message);
    if (!text) {
      console.log(`Ignored non-text/empty incoming message id=${messageId}`);
      return;
    }

    const phone = normalizePhoneFromJid(chatId);
    try {
      const payload = {
        from: phone,
        name: message?.notifyName || message?._data?.notifyName || null,
        message: text,
        messageId,
        timestamp: message?.timestamp ? String(message.timestamp) : null,
        teamId: TEAM_ID,
        eventType: 'incoming_message',
      };

      const ai = await askAiForReply(payload);
      if (ai?.shouldReply === false) {
        console.log(`AI reply suppressed for ${phone} (${ai?.suppressed || 'no_reason'})`);
        return;
      }
      if (!ai || typeof ai.reply !== 'string' || !ai.reply.trim()) {
        console.warn(`No AI reply returned for incoming message id=${messageId}`);
        return;
      }

      await sendTypingAndText(client, chatId, ai.reply.trim());
      console.log(`Replied to ${phone}: ${ai.reply.slice(0, 80)}`);
    } catch (error) {
      const msgText =
        error?.response?.data
          ? JSON.stringify(error.response.data)
          : error?.message || String(error);
      console.error(`Failed to process incoming message ${messageId}: ${msgText}`);
    }
  });

  const initializeWatchdog = setTimeout(() => {
    if (isShuttingDown || clientReady || activeClient !== client) return;
    console.warn(
      'Bridge initialization timed out before QR/ready. Forcing clean re-link.'
    );
    void (async () => {
      await reportBridgeState({
        status: 'qr_required',
        reason: 'Bridge initialization timeout. Regenerating QR.',
      });
      await requestBridgeReconnect('Bridge initialization timeout', true);
    })();
  }, 90000);

  try {
    await client.initialize();
  } finally {
    clearTimeout(initializeWatchdog);
  }
}

acquireProcessLock();
startHeartbeatLoop();
startControlPolling();
startBridge().catch((error) => {
  console.error('Bridge failed to start:', error);
  void reportBridgeState({
    status: 'error',
    qrText: null,
    reason: error?.message || String(error),
  });
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
