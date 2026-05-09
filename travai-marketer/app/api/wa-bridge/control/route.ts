import { NextRequest, NextResponse } from 'next/server';
import { IndexType, Query } from 'node-appwrite';
import {
  APPWRITE_DATABASE_ID,
  createDocument,
  getDatabaseClient,
  listDocuments,
  updateDocument,
} from '@/lib/appwrite';

const BRIDGE_SHARED_SECRET = process.env.BRIDGE_SHARED_SECRET || '';
const BRIDGE_INSTANCE_KEY =
  (process.env.BRIDGE_INSTANCE_KEY || 'oracle-bridge-lock-v1').trim();
const BRIDGE_COMMANDS_COLLECTION = 'bridge_commands';
const VALID_ACTIONS = new Set(['restart', 'relink', 'send_text', 'send_template']);
const VALID_STATUSES = new Set(['pending', 'executing', 'completed', 'failed']);

interface CreateCommandBody {
  teamId?: string;
  action?: string;
  payload?: {
    phone?: string;
    message?: string;
    customerId?: string;
    buttons?: string[];
  } | null;
}

interface AckCommandBody {
  commandId?: string;
  status?: string;
  message?: string | null;
}

const PAYLOAD_PREFIX = '__payload__:';

let commandsCollectionReady = false;
let commandsCollectionInitPromise: Promise<void> | null = null;

function resolveTeamId(preferred?: string) {
  if (preferred && preferred.trim().length > 0) return preferred.trim();
  return process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'system';
}

function isAlreadyExistsError(error: unknown) {
  const e = error as { code?: number; type?: string; message?: string };
  const text = `${e?.type || ''} ${e?.message || ''}`.toLowerCase();
  return e?.code === 409 || text.includes('already exists');
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized bridge request' }, { status: 401 });
}

function isAuthorizedBridgeRequest(request: NextRequest) {
  const providedSecret = request.headers.get('x-bridge-secret');
  if (providedSecret !== BRIDGE_SHARED_SECRET) return false;
  const providedInstanceKey = request.headers.get('x-bridge-instance-key') || '';
  if (BRIDGE_INSTANCE_KEY && providedInstanceKey !== BRIDGE_INSTANCE_KEY) return false;
  return true;
}

async function ensureCommandsCollection() {
  if (commandsCollectionReady) return;
  if (commandsCollectionInitPromise) {
    await commandsCollectionInitPromise;
    return;
  }

  commandsCollectionInitPromise = (async () => {
    const db = getDatabaseClient();
    let collectionExists = false;
    try {
      await db.getCollection(APPWRITE_DATABASE_ID, BRIDGE_COMMANDS_COLLECTION);
      collectionExists = true;
    } catch {
      // Collection missing: create below.
    }

    if (!collectionExists) {
      try {
        await db.createCollection(
          APPWRITE_DATABASE_ID,
          BRIDGE_COMMANDS_COLLECTION,
          'Bridge Commands'
        );
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }
      }
    }

    const ensure = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }
      }
    };

    await ensure(() =>
      db.createStringAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_COMMANDS_COLLECTION,
        'teamId',
        128,
        true
      )
    );
    await ensure(() =>
      db.createStringAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_COMMANDS_COLLECTION,
        'action',
        32,
        true
      )
    );
    await ensure(() =>
      db.createStringAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_COMMANDS_COLLECTION,
        'status',
        32,
        true
      )
    );
    await ensure(() =>
      db.createStringAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_COMMANDS_COLLECTION,
        'message',
        512,
        false
      )
    );
    await ensure(() =>
      db.createStringAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_COMMANDS_COLLECTION,
        'payload',
        4096,
        false
      )
    );
    await ensure(() =>
      db.createDatetimeAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_COMMANDS_COLLECTION,
        'requestedAt',
        true
      )
    );
    await ensure(() =>
      db.createDatetimeAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_COMMANDS_COLLECTION,
        'updatedAt',
        true
      )
    );
    await ensure(() =>
      db.createDatetimeAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_COMMANDS_COLLECTION,
        'executedAt',
        false
      )
    );
    await ensure(() =>
      db.createIndex(
        APPWRITE_DATABASE_ID,
        BRIDGE_COMMANDS_COLLECTION,
        'team_status_requested_idx',
        IndexType.Key,
        ['teamId', 'status', 'requestedAt'],
        ['asc', 'asc', 'asc']
      )
    );

    commandsCollectionReady = true;
  })();

  try {
    await commandsCollectionInitPromise;
  } finally {
    commandsCollectionInitPromise = null;
  }
}

async function markCommand(
  commandId: string,
  status: string,
  message: string | null = null
) {
  const now = new Date().toISOString();
  return updateDocument(BRIDGE_COMMANDS_COLLECTION, commandId, {
    status,
    message,
    updatedAt: now,
    executedAt: status === 'completed' || status === 'failed' ? now : null,
  });
}

function parsePayloadFromString(value?: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parsePayloadFromMessageField(message?: string | null) {
  if (!message || !message.startsWith(PAYLOAD_PREFIX)) return null;
  const raw = message.slice(PAYLOAD_PREFIX.length);
  return parsePayloadFromString(raw);
}

function isUnknownPayloadAttributeError(error: unknown) {
  const e = error as { code?: number; message?: string; response?: { message?: string } };
  const text = `${e?.message || ''} ${e?.response?.message || ''}`.toLowerCase();
  return e?.code === 400 && text.includes('unknown attribute') && text.includes('payload');
}

export async function GET(request: NextRequest) {
  try {
    if (!BRIDGE_SHARED_SECRET) {
      return NextResponse.json(
        { error: 'BRIDGE_SHARED_SECRET is not configured on server.' },
        { status: 500 }
      );
    }

    if (!isAuthorizedBridgeRequest(request)) {
      return unauthorized();
    }

    const { searchParams } = new URL(request.url);
    const teamId = resolveTeamId(searchParams.get('teamId') || undefined);

    await ensureCommandsCollection();

    const result = await listDocuments(BRIDGE_COMMANDS_COLLECTION, [
      Query.equal('teamId', teamId),
      Query.equal('status', 'pending'),
      Query.orderAsc('requestedAt'),
      Query.limit(1),
    ]);

    if (!result.documents.length) {
      return NextResponse.json({ command: null });
    }

    const command = result.documents[0] as {
      $id: string;
      action?: string;
      requestedAt?: string;
      payload?: string | null;
    };

    await markCommand(command.$id, 'executing', 'Picked by bridge');

    const payload =
      parsePayloadFromString(command.payload) ||
      parsePayloadFromMessageField((command as { message?: string | null }).message);

    return NextResponse.json({
      command: {
        id: command.$id,
        action: command.action || 'restart',
        requestedAt: command.requestedAt || null,
        payload,
      },
    });
  } catch (error) {
    console.error('[WA Bridge Control GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bridge command' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureCommandsCollection();
    const body = (await request.json()) as CreateCommandBody & AckCommandBody;
    const isBridge = BRIDGE_SHARED_SECRET && isAuthorizedBridgeRequest(request);

    if (isBridge && body.commandId && body.status) {
      const status = body.status.trim().toLowerCase();
      if (!VALID_STATUSES.has(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      await markCommand(body.commandId, status, body.message || null);
      return NextResponse.json({ success: true });
    }

    // Dashboard command create
    const action = body.action?.trim().toLowerCase() || '';
    if (!VALID_ACTIONS.has(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const teamId = resolveTeamId(body.teamId);
    const now = new Date().toISOString();
    const payloadObj = body.payload || null;

    if (action === 'send_text' || action === 'send_template') {
      const phone = payloadObj?.phone?.trim() || '';
      const text = payloadObj?.message?.trim() || '';
      if (!phone || !text) {
        return NextResponse.json({
          error: `${action} requires payload.phone and payload.message`,
        }, { status: 400 });
      }
      if (action === 'send_template' && Array.isArray(payloadObj?.buttons)) {
        const valid = payloadObj.buttons.every((btn) => String(btn || '').trim().length > 0);
        if (!valid || payloadObj.buttons.length > 3) {
          return NextResponse.json({
            error: 'send_template payload.buttons must be 1-3 non-empty labels',
          }, { status: 400 });
        }
      }
    }

    // Prevent flooding duplicate pending actions.
    if (action !== 'send_text') {
      const pending = await listDocuments(BRIDGE_COMMANDS_COLLECTION, [
        Query.equal('teamId', teamId),
        Query.equal('status', 'pending'),
        Query.equal('action', action),
        Query.limit(1),
      ]);
      if (pending.documents.length > 0) {
        return NextResponse.json({
          success: true,
          deduped: true,
          commandId: (pending.documents[0] as { $id: string }).$id,
        });
      }
    }

    const baseDoc = {
      teamId,
      action,
      status: 'pending',
      requestedAt: now,
      updatedAt: now,
      executedAt: null,
    };

    let created;
    try {
      created = await createDocument(BRIDGE_COMMANDS_COLLECTION, {
        ...baseDoc,
        message: null,
        payload: payloadObj ? JSON.stringify(payloadObj) : null,
      });
    } catch (error) {
      if (!isUnknownPayloadAttributeError(error)) {
        throw error;
      }
      // Backward-compatible fallback when existing Appwrite collection lacks `payload`.
      const fallbackMessage = payloadObj
        ? `${PAYLOAD_PREFIX}${JSON.stringify(payloadObj)}`
        : null;
      created = await createDocument(BRIDGE_COMMANDS_COLLECTION, {
        ...baseDoc,
        message: fallbackMessage,
      });
    }

    return NextResponse.json({
      success: true,
      commandId: (created as { $id: string }).$id,
      action,
      teamId,
    });
  } catch (error) {
    console.error('[WA Bridge Control POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process bridge control request' },
      { status: 500 }
    );
  }
}
