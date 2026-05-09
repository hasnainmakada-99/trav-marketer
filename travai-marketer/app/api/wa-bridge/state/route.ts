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
const BRIDGE_STATE_COLLECTION = 'bridge_state';

type BridgeStatus = 'starting' | 'connected' | 'disconnected' | 'qr_required' | 'error';

interface BridgeStatePayload {
  teamId?: string;
  status?: BridgeStatus;
  qrText?: string | null;
  reason?: string | null;
  linkedPhone?: string | null;
  heartbeatAt?: string;
}

let bridgeCollectionReady = false;
let bridgeCollectionInitPromise: Promise<void> | null = null;
const VALID_STATUSES = new Set<BridgeStatus>([
  'starting',
  'connected',
  'disconnected',
  'qr_required',
  'error',
]);

function isAlreadyExistsError(error: unknown) {
  const e = error as { code?: number; type?: string; message?: string };
  const text = `${e?.type || ''} ${e?.message || ''}`.toLowerCase();
  return e?.code === 409 || text.includes('already exists');
}

function sanitizeStatus(status?: string): BridgeStatus {
  if (status && VALID_STATUSES.has(status as BridgeStatus)) {
    return status as BridgeStatus;
  }
  return 'starting';
}

function sanitizeIsoDate(value?: string) {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString();
  }
  return d.toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveTeamId(preferred?: string) {
  if (preferred && preferred.trim().length > 0) {
    return preferred.trim();
  }
  return process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'system';
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized bridge request' }, { status: 401 });
}

async function ensureBridgeStateCollection() {
  if (bridgeCollectionReady) {
    return;
  }
  if (bridgeCollectionInitPromise) {
    await bridgeCollectionInitPromise;
    return;
  }

  bridgeCollectionInitPromise = (async () => {
    const db = getDatabaseClient();

    try {
      await db.getCollection(APPWRITE_DATABASE_ID, BRIDGE_STATE_COLLECTION);
      bridgeCollectionReady = true;
      return;
    } catch {
      // Collection missing: continue and create below.
    }

    try {
      await db.createCollection(
        APPWRITE_DATABASE_ID,
        BRIDGE_STATE_COLLECTION,
        'Bridge State'
      );
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }

    // Attributes are async in Appwrite; first writes may need a retry shortly after creation.
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
        BRIDGE_STATE_COLLECTION,
        'teamId',
        128,
        true
      )
    );
    await ensure(() =>
      db.createStringAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_STATE_COLLECTION,
        'status',
        32,
        true
      )
    );
    await ensure(() =>
      db.createStringAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_STATE_COLLECTION,
        'qrText',
        4096,
        false
      )
    );
    await ensure(() =>
      db.createStringAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_STATE_COLLECTION,
        'reason',
        512,
        false
      )
    );
    await ensure(() =>
      db.createStringAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_STATE_COLLECTION,
        'linkedPhone',
        64,
        false
      )
    );
    await ensure(() =>
      db.createDatetimeAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_STATE_COLLECTION,
        'heartbeatAt',
        true
      )
    );
    await ensure(() =>
      db.createDatetimeAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_STATE_COLLECTION,
        'updatedAt',
        true
      )
    );
    await ensure(() =>
      db.createDatetimeAttribute(
        APPWRITE_DATABASE_ID,
        BRIDGE_STATE_COLLECTION,
        'linkedAt',
        false
      )
    );

    await ensure(() =>
      db.createIndex(
        APPWRITE_DATABASE_ID,
        BRIDGE_STATE_COLLECTION,
        'teamId_idx',
        IndexType.Key,
        ['teamId'],
        ['asc']
      )
    );

    bridgeCollectionReady = true;
  })();

  try {
    await bridgeCollectionInitPromise;
  } finally {
    bridgeCollectionInitPromise = null;
  }
}

async function findBridgeState(teamId: string) {
  try {
    const byTeam = await listDocuments(BRIDGE_STATE_COLLECTION, [
      Query.equal('teamId', teamId),
      Query.orderDesc('$updatedAt'),
      Query.limit(1),
    ]);
    if (byTeam.documents.length > 0) {
      return byTeam.documents[0] as { $id: string };
    }
  } catch (error) {
    // Fallback for index propagation delays.
    console.warn('[WA Bridge State] teamId query failed, trying fallback scan');
    console.warn(error);
  }

  const scan = await listDocuments(BRIDGE_STATE_COLLECTION, [
    Query.orderDesc('$updatedAt'),
    Query.limit(100),
  ]);
  const row = scan.documents.find(
    (doc) => (doc as { teamId?: string }).teamId === teamId
  );
  return (row as { $id: string } | undefined) || null;
}

async function upsertBridgeState(payload: Required<BridgeStatePayload>) {
  await ensureBridgeStateCollection();
  const existing = await findBridgeState(payload.teamId);

  const linkedAtValue =
    payload.status === 'connected' ? payload.heartbeatAt : null;

  const updatePayload = {
    teamId: payload.teamId,
    status: payload.status,
    qrText: payload.qrText || null,
    reason: payload.reason || null,
    linkedPhone: payload.linkedPhone || null,
    heartbeatAt: payload.heartbeatAt,
    updatedAt: payload.heartbeatAt,
    linkedAt: linkedAtValue,
  };

  if (existing) {
    return updateDocument(BRIDGE_STATE_COLLECTION, existing.$id, updatePayload);
  }

  return createDocument(BRIDGE_STATE_COLLECTION, updatePayload);
}

async function upsertWithRetry(payload: Required<BridgeStatePayload>) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await upsertBridgeState(payload);
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      await sleep(600 * attempt);
    }
  }
}

/**
 * POST /api/wa-bridge/state
 * Bridge heartbeat + connection state + QR payload for dashboard relink UX.
 */
export async function POST(request: NextRequest) {
  try {
    if (!BRIDGE_SHARED_SECRET) {
      return NextResponse.json(
        { error: 'BRIDGE_SHARED_SECRET is not configured on server.' },
        { status: 500 }
      );
    }

    const providedSecret = request.headers.get('x-bridge-secret');
    if (providedSecret !== BRIDGE_SHARED_SECRET) {
      return unauthorized();
    }

    const body = (await request.json()) as BridgeStatePayload;
    const teamId = resolveTeamId(body.teamId);
    const status = sanitizeStatus(body.status);
    const heartbeatAt = sanitizeIsoDate(body.heartbeatAt);

    await upsertWithRetry({
      teamId,
      status,
      qrText: body.qrText || null,
      reason: body.reason || null,
      linkedPhone: body.linkedPhone || null,
      heartbeatAt,
    });

    return NextResponse.json({ success: true, teamId, status, heartbeatAt });
  } catch (error) {
    console.error('[WA Bridge State POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to persist bridge state' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/wa-bridge/state?teamId=...
 * Dashboard fetches latest bridge status and QR data for relink flow.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = resolveTeamId(searchParams.get('teamId') || undefined);

    await ensureBridgeStateCollection();

    const row = await findBridgeState(teamId);
    if (!row) {
      return NextResponse.json({
        teamId,
        status: 'starting',
        qrText: null,
        reason: null,
        linkedPhone: null,
        heartbeatAt: null,
      });
    }

    const state = row as {
      teamId?: string;
      status?: string;
      qrText?: string | null;
      reason?: string | null;
      linkedPhone?: string | null;
      heartbeatAt?: string | null;
      linkedAt?: string | null;
      updatedAt?: string | null;
    };

    return NextResponse.json({
      teamId: state.teamId || teamId,
      status: sanitizeStatus(state.status),
      qrText: state.qrText || null,
      reason: state.reason || null,
      linkedPhone: state.linkedPhone || null,
      heartbeatAt: state.heartbeatAt || null,
      linkedAt: state.linkedAt || null,
      updatedAt: state.updatedAt || null,
    });
  } catch (error) {
    console.error('[WA Bridge State GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bridge state' },
      { status: 500 }
    );
  }
}
