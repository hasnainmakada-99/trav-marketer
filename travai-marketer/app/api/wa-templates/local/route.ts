import { NextRequest, NextResponse } from 'next/server';
import { IndexType, Query } from 'node-appwrite';
import { getActiveDataBackend } from '@/lib/data-backend';
import {
  APPWRITE_DATABASE_ID,
  createDocument,
  deleteDocument,
  getDatabaseClient,
  listDocuments,
  updateDocument,
} from '@/lib/appwrite';

const COLLECTION_ID = 'wa_local_templates';

type LocalTemplateDoc = {
  $id: string;
  teamId: string;
  name: string;
  body: string;
  buttons?: string | null;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

let ready = false;
let initPromise: Promise<void> | null = null;

function isAlreadyExists(error: unknown) {
  const e = error as { code?: number; type?: string; message?: string };
  const text = `${e?.type || ''} ${e?.message || ''}`.toLowerCase();
  return e?.code === 409 || text.includes('already exists');
}

function parseButtons(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .slice(0, 3);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return parseButtons(parsed);
    } catch {
      return raw
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 3);
    }
  }
  return [];
}

async function ensureCollection() {
  if (getActiveDataBackend() === 'pocketbase') {
    ready = true;
    return;
  }

  if (ready) return;
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    const db = getDatabaseClient();
    let exists = false;
    try {
      await db.getCollection(APPWRITE_DATABASE_ID, COLLECTION_ID);
      exists = true;
    } catch {
      // create below
    }

    if (!exists) {
      try {
        await db.createCollection(APPWRITE_DATABASE_ID, COLLECTION_ID, 'WA Local Templates');
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
    }

    const ensure = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
    };

    await ensure(() =>
      db.createStringAttribute(APPWRITE_DATABASE_ID, COLLECTION_ID, 'teamId', 128, true)
    );
    await ensure(() =>
      db.createStringAttribute(APPWRITE_DATABASE_ID, COLLECTION_ID, 'name', 180, true)
    );
    await ensure(() =>
      db.createStringAttribute(APPWRITE_DATABASE_ID, COLLECTION_ID, 'body', 8000, true)
    );
    await ensure(() =>
      db.createStringAttribute(APPWRITE_DATABASE_ID, COLLECTION_ID, 'buttons', 2000, false)
    );
    await ensure(() =>
      db.createBooleanAttribute(APPWRITE_DATABASE_ID, COLLECTION_ID, 'isActive', true, true)
    );
    await ensure(() =>
      db.createDatetimeAttribute(APPWRITE_DATABASE_ID, COLLECTION_ID, 'createdAt', true)
    );
    await ensure(() =>
      db.createDatetimeAttribute(APPWRITE_DATABASE_ID, COLLECTION_ID, 'updatedAt', true)
    );
    await ensure(() =>
      db.createIndex(
        APPWRITE_DATABASE_ID,
        COLLECTION_ID,
        'team_active_updated_idx',
        IndexType.Key,
        ['teamId', 'isActive', 'updatedAt'],
        ['asc', 'asc', 'desc']
      )
    );

    ready = true;
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

function toResponse(doc: LocalTemplateDoc) {
  const buttons = parseButtons(doc.buttons || null);
  return {
    id: doc.$id,
    teamId: doc.teamId,
    name: doc.name,
    body: doc.body,
    buttons,
    isActive: doc.isActive !== false,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

export async function GET(request: NextRequest) {
  try {
    await ensureCollection();
    const teamId =
      request.nextUrl.searchParams.get('teamId') ||
      process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID ||
      'system';

    const result = await listDocuments(COLLECTION_ID, [
      Query.equal('teamId', teamId),
      Query.equal('isActive', true),
      Query.orderDesc('updatedAt'),
      Query.limit(100),
    ]);
    const docs = result.documents as unknown as LocalTemplateDoc[];

    return NextResponse.json({
      templates: docs.map(toResponse),
    });
  } catch (error) {
    console.error('[WA Local Templates GET] Error:', error);
    return NextResponse.json({ error: 'Failed to load local templates' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureCollection();
    const body = await request.json();
    const teamId =
      (body.teamId as string) ||
      process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID ||
      'system';
    const name = String(body.name || '').trim();
    const templateBody = String(body.body || '').trim();
    const buttons = parseButtons(body.buttons);

    if (!name || !templateBody) {
      return NextResponse.json({ error: 'name and body are required' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const created = (await createDocument(COLLECTION_ID, {
      teamId,
      name,
      body: templateBody,
      buttons: buttons.length ? JSON.stringify(buttons) : null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })) as unknown as LocalTemplateDoc;

    return NextResponse.json({ success: true, template: toResponse(created) });
  } catch (error) {
    console.error('[WA Local Templates POST] Error:', error);
    return NextResponse.json({ error: 'Failed to create local template' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureCollection();
    const body = await request.json();
    const id = String(body.id || '').trim();
    const name = String(body.name || '').trim();
    const templateBody = String(body.body || '').trim();
    const buttons = parseButtons(body.buttons);

    if (!id || !name || !templateBody) {
      return NextResponse.json({ error: 'id, name, and body are required' }, { status: 400 });
    }

    const updated = (await updateDocument(COLLECTION_ID, id, {
      name,
      body: templateBody,
      buttons: buttons.length ? JSON.stringify(buttons) : null,
      updatedAt: new Date().toISOString(),
    })) as unknown as LocalTemplateDoc;

    return NextResponse.json({ success: true, template: toResponse(updated) });
  } catch (error) {
    console.error('[WA Local Templates PUT] Error:', error);
    return NextResponse.json({ error: 'Failed to update local template' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureCollection();
    const id = request.nextUrl.searchParams.get('id') || '';
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    await deleteDocument(COLLECTION_ID, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[WA Local Templates DELETE] Error:', error);
    return NextResponse.json({ error: 'Failed to delete local template' }, { status: 500 });
  }
}
