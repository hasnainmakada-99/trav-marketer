import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import {
  createDocument,
  deleteDocument,
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
  // PocketBase handles schema automatically
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
