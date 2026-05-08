import dotenv from 'dotenv';
import axios from 'axios';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateWAMessageFromContent,
  proto,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import fs from 'node:fs';
import path from 'node:path';

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
const lockFilePath = path.resolve(process.cwd(), '.bridge.lock');
const authStatePath = path.resolve(process.cwd(), 'baileys_auth');
let reconnectTimer = null;
let reconnectInProgress = false;
let activeSock = null;
let isShuttingDown = false;
let heartbeatTimer = null;
let controlPollTimer = null;
let controlPollInFlight = false;
let latestBridgeStatus = 'starting';
let latestBridgeReason = 'Initializing bridge session';
let latestLinkedPhone = null;
const botSentMessageIds = new Set();

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
      console.warn('Cleared stale Baileys auth state. QR re-link required.');
    }
  } catch (error) {
    console.error('Failed to clear auth state:', error?.message || String(error));
  }
}

function resolveLinkedPhone(rawUserId) {
  // Baileys user id can look like: 1234567890:3@s.whatsapp.net
  const beforeColon = String(rawUserId || '').split(':')[0] || '';
  return normalizePhoneFromJid(beforeColon);
}

function setBridgeSnapshot(status, reason = null, linkedPhone = null) {
  latestBridgeStatus = status || latestBridgeStatus;
  latestBridgeReason = reason;
  if (linkedPhone !== undefined) {
    latestLinkedPhone = linkedPhone;
  }
}

function getTextFromMessage(message) {
  if (!message) return '';
  if (typeof message.conversation === 'string') return message.conversation;
  if (typeof message.extendedTextMessage?.text === 'string') {
    return message.extendedTextMessage.text;
  }
  if (typeof message.imageMessage?.caption === 'string') {
    return message.imageMessage.caption;
  }
  if (typeof message.videoMessage?.caption === 'string') {
    return message.videoMessage.caption;
  }
  if (typeof message.buttonsResponseMessage?.selectedDisplayText === 'string') {
    const label = message.buttonsResponseMessage.selectedDisplayText.trim();
    const id = String(message.buttonsResponseMessage.selectedButtonId || '').trim();
    return id ? `${label} (${id})` : label;
  }
  if (typeof message.templateButtonReplyMessage?.selectedDisplayText === 'string') {
    const label = message.templateButtonReplyMessage.selectedDisplayText.trim();
    const id = String(message.templateButtonReplyMessage.selectedId || '').trim();
    return id ? `${label} (${id})` : label;
  }
  if (
    typeof message.listResponseMessage?.singleSelectReply?.selectedRowId === 'string'
  ) {
    const rowId = message.listResponseMessage.singleSelectReply.selectedRowId.trim();
    const title = String(message.listResponseMessage?.title || '').trim();
    return title ? `${title} (${rowId})` : rowId;
  }
  const nativeParams = message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (typeof nativeParams === 'string' && nativeParams.trim()) {
    try {
      const parsed = JSON.parse(nativeParams);
      const title = String(parsed?.title || parsed?.display_text || '').trim();
      const id = String(parsed?.id || parsed?.row_id || '').trim();
      if (title && id) return `${title} (${id})`;
      if (title) return title;
      if (id) return id;
    } catch {
      return nativeParams.trim();
    }
  }
  return '';
}

function normalizePhoneFromJid(jid) {
  return (jid || '')
    .replace('@s.whatsapp.net', '')
    .replace('@lid', '')
    .replace('@pn', '')
    .trim();
}

function isDirectUserJid(jid) {
  return (
    typeof jid === 'string' &&
    (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid') || jid.endsWith('@pn'))
  );
}

function toDirectJid(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rememberBotMessageId(response) {
  const id = response?.key?.id;
  if (!id) return;
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

async function sendTypingAndText(sock, jid, text) {
  try {
    await sock.sendPresenceUpdate('composing', jid);
  } catch {
    // best-effort presence
  }
  const dynamicDelay = Math.max(500, Math.min(2200, Math.floor((text?.length || 0) * 12)));
  await sleep(dynamicDelay);
  const sent = await sock.sendMessage(jid, { text });
  rememberBotMessageId(sent);
  try {
    await sock.sendPresenceUpdate('paused', jid);
  } catch {
    // best-effort presence
  }
  return sent;
}

async function sendSupportButtons(sock, jid, headerText, options) {
  const maxButtons = Math.min(3, Math.max(1, options.length));
  const selected = options.slice(0, maxButtons);

  // Strategy:
  // 1) Try hydrated template quick-reply buttons via relayMessage (most reliable for this style)
  // 2) Try native-flow quick reply buttons
  // 3) Try template quick-reply buttons
  // 4) Fallback to numbered text prompt
  try {
    const hydratedButtons = selected.map((label, index) => ({
      index: index + 1,
      quickReplyButton: {
        displayText: label,
        id: `svc_${index + 1}`,
      },
    }));

    const content = proto.Message.fromObject({
      templateMessage: {
        hydratedTemplate: {
          hydratedContentText: headerText,
          hydratedFooterText: 'Traventions Customer Support',
          hydratedButtons,
        },
      },
    });
    const waMsg = generateWAMessageFromContent(jid, content, {
      userJid: sock.user?.id || '',
    });
    await sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id });
    rememberBotMessageIdById(waMsg.key.id);
    console.log(`Sent support menu as hydrated template buttons to ${jid}`);
    return { key: { id: waMsg.key.id } };
  } catch (hydratedError) {
    console.warn(
      `Hydrated template buttons unavailable for ${jid}: ${hydratedError?.message || String(hydratedError)}`
    );
  }

  try {
    const quickReplyButtons = selected.slice(0, 3).map((label, index) => ({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: label,
        id: `svc_${index + 1}`,
      }),
    }));

    const sentNative = await sock.sendMessage(jid, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
          },
          interactiveMessage: proto.Message.InteractiveMessage.create({
            body: proto.Message.InteractiveMessage.Body.create({
              text: headerText,
            }),
            footer: proto.Message.InteractiveMessage.Footer.create({
              text: 'Traventions Customer Support',
            }),
            nativeFlowMessage:
              proto.Message.InteractiveMessage.NativeFlowMessage.create({
                buttons: quickReplyButtons,
              }),
          }),
        },
      },
    });
    rememberBotMessageId(sentNative);
    console.log(`Sent support menu as native quick-reply buttons to ${jid}`);
    return sentNative;
  } catch (nativeError) {
    console.warn(
      `Native-flow buttons unavailable for ${jid}: ${nativeError?.message || String(nativeError)}`
    );
  }

  const templateButtons = selected.map((label, index) => ({
    index: index + 1,
    quickReplyButton: {
      displayText: label,
      id: `svc_${index + 1}`,
    },
  }));

  try {
    const sentTemplate = await sock.sendMessage(jid, {
      text: headerText,
      footer: 'Traventions Customer Support',
      templateButtons,
    });
    rememberBotMessageId(sentTemplate);
    console.log(`Sent support menu as template quick-reply buttons to ${jid}`);
    return sentTemplate;
  } catch (templateError) {
    console.warn(
      `Template buttons unavailable for ${jid}: ${templateError?.message || String(templateError)}`
    );
  }

  const legacyButtons = selected.map((label, index) => ({
    buttonId: `svc_${index + 1}`,
    buttonText: { displayText: label },
    type: 1,
  }));

  try {
    const sentLegacy = await sock.sendMessage(jid, {
      text: headerText,
      footer: 'Traventions Customer Support',
      buttons: legacyButtons,
      headerType: 1,
    });
    rememberBotMessageId(sentLegacy);
    console.log(`Sent support menu as legacy buttons to ${jid}`);
    return sentLegacy;
  } catch (legacyError) {
    console.warn(
      `Legacy buttons unavailable for ${jid}: ${legacyError?.message || String(legacyError)}`
    );
  }

  const fallback = selected.map((label, idx) => `${idx + 1}. ${label}`).join('\n');
  const sentText = await sock.sendMessage(jid, {
    text: `${headerText}\n\n${fallback}\n\nReply with 1/2/3`,
  });
  rememberBotMessageId(sentText);
  console.log(`Sent support menu as numbered text fallback to ${jid}`);
  return sentText;
}

async function askAiForReply(payload) {
  const response = await axios.post(NEXT_APP_BRIDGE_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      'x-bridge-secret': BRIDGE_SHARED_SECRET,
    },
    timeout: 30000,
  });
  return response.data;
}

async function reportBridgeState({
  status,
  qrText = null,
  reason = null,
  linkedPhone = null,
}) {
  setBridgeSnapshot(status, reason, linkedPhone);
  try {
    await axios.post(
      NEXT_APP_BRIDGE_STATE_URL,
      {
        teamId: TEAM_ID,
        status,
        qrText,
        reason,
        linkedPhone,
        heartbeatAt: new Date().toISOString(),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-bridge-secret': BRIDGE_SHARED_SECRET,
        },
        timeout: 10000,
      }
    );
  } catch (error) {
    const msg = error?.response?.data
      ? JSON.stringify(error.response.data)
      : error?.message || String(error);
    console.error(`Failed to report bridge state (${status}): ${msg}`);
  }
}

function startHeartbeatLoop() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (isShuttingDown) return;
    reportBridgeState({
      status: latestBridgeStatus,
      reason: latestBridgeReason,
      linkedPhone: latestLinkedPhone,
    });
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
        timeout: 10000,
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

  if (activeSock) {
    try {
      await activeSock.end(new Error(reason || 'restart requested'));
    } catch {
      // Best effort socket shutdown.
    }
  }

  // In local mode there may be no process manager (PM2), so reconnect in-process.
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
      timeout: 10000,
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
      if (!activeSock || latestBridgeStatus !== 'connected') {
        await ackCommand(command.id, 'failed', 'Bridge is not connected');
        return;
      }

      const jid = toDirectJid(phone);
      try {
        await sendTypingAndText(activeSock, jid, message);
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
      if (!activeSock || latestBridgeStatus !== 'connected') {
        await ackCommand(command.id, 'failed', 'Bridge is not connected');
        return;
      }

      const jid = toDirectJid(phone);
      try {
        await sendTypingAndText(activeSock, jid, message);
        if (buttonLabels.length > 0) {
          await sendSupportButtons(
            activeSock,
            jid,
            'Please tap one option below to continue:',
            buttonLabels
          );
        }
        await ackCommand(command.id, 'completed', `Sent template to ${phone}`);
        console.log(
          `Bridge sent template message to ${phone}: ${message.slice(0, 80)} (buttons=${buttonLabels.length})`
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
    status: 'starting',
    reason: 'Initializing bridge session',
  });

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { state, saveCreds } = await useMultiFileAuthState('./baileys_auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: true,
    syncFullHistory: false,
    browser: ['TravAI Bridge', 'Chrome', '1.0.0'],
  });
  activeSock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan this QR in WhatsApp (Linked Devices):\n');
      qrcode.generate(qr, { small: true });
      await reportBridgeState({
        status: 'qr_required',
        qrText: qr,
        reason: 'QR generated. Scan to relink WhatsApp device.',
      });
    }

    if (connection === 'open') {
      console.log('Baileys bridge connected and ready.');
      const linkedPhone = resolveLinkedPhone(sock?.user?.id);
      await reportBridgeState({
        status: 'connected',
        qrText: null,
        reason: null,
        linkedPhone: linkedPhone || latestLinkedPhone,
      });
    }

    if (connection === 'close') {
      if (isShuttingDown) {
        return;
      }
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.warn(`Bridge disconnected (code: ${statusCode || 'unknown'})`);
      await reportBridgeState({
        status: loggedOut ? 'qr_required' : 'disconnected',
        qrText: null,
        reason: `Disconnected with code: ${statusCode || 'unknown'}`,
      });

      if (loggedOut) {
        console.warn('Logged out from WhatsApp. Re-scan QR to continue.');
        clearAuthState();
        scheduleReconnect(2000);
      } else {
        scheduleReconnect(1500);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        const jid = msg?.key?.remoteJid || '';
        const fromMe = Boolean(msg?.key?.fromMe);
        const id = msg?.key?.id || 'unknown';

        if (fromMe) {
          if (botSentMessageIds.has(id)) {
            botSentMessageIds.delete(id);
            console.log(`Ignored bot outgoing message id=${id}`);
            continue;
          }
          if (isDirectUserJid(jid)) {
            const ownText = getTextFromMessage(msg.message);
            if (ownText && ownText.trim()) {
              const phone = normalizePhoneFromJid(jid);
              await askAiForReply({
                from: phone,
                name: null,
                message: ownText.trim(),
                messageId: id,
                timestamp: msg?.messageTimestamp ? String(msg.messageTimestamp) : null,
                teamId: TEAM_ID,
                eventType: 'staff_outgoing',
              });
              console.log(`Recorded human handover from WhatsApp app/web for ${phone}`);
            }
          } else {
            console.log(`Ignored own non-direct outgoing message id=${id}`);
          }
          continue;
        }
        if (!isDirectUserJid(jid)) {
          console.log(`Ignored non-direct chat jid=${jid} id=${id}`);
          continue;
        }

        const text = getTextFromMessage(msg.message);
        if (!text || !text.trim()) {
          console.log(`Ignored non-text/empty message from ${jid} id=${id}`);
          continue;
        }

        const phone = normalizePhoneFromJid(jid);
        console.log(`Incoming message from ${phone}: ${text.slice(0, 120)}`);
        const payload = {
          from: phone,
          name: msg.pushName || null,
          message: text.trim(),
          messageId: id,
          timestamp: msg?.messageTimestamp ? String(msg.messageTimestamp) : null,
          teamId: TEAM_ID,
          eventType: 'incoming_message',
        };

        const ai = await askAiForReply(payload);
        if (ai?.shouldReply === false) {
          console.log(
            `AI reply suppressed for ${phone} (${ai?.suppressed || 'no_reason'})`
          );
          continue;
        }

        if (!ai || typeof ai.reply !== 'string' || !ai.reply.trim()) {
          console.warn('No reply returned for message:', payload.messageId);
          continue;
        }

        // Text-only mode: avoid interactive/template payloads that can appear as
        // "Waiting for this message" on some WhatsApp clients.
        await sendTypingAndText(sock, jid, ai.reply.trim());
        console.log(`Replied to ${phone}: ${ai.reply.slice(0, 80)}`);
      } catch (error) {
        const msgText =
          error?.response?.data
            ? JSON.stringify(error.response.data)
            : error?.message || String(error);
        console.error('Failed to process incoming message:', msgText);
      }
    }
  });
}

acquireProcessLock();
startHeartbeatLoop();
startControlPolling();
startBridge().catch((error) => {
  console.error('Bridge failed to start:', error);
  reportBridgeState({
    status: 'error',
    qrText: null,
    reason: error?.message || String(error),
  });
  releaseProcessLock();
  stopHeartbeatLoop();
  stopControlPolling();
  process.exit(1);
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
