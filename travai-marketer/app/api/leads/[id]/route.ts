import { NextRequest, NextResponse } from 'next/server';
import { updateDocument } from '@/lib/appwrite';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Missing lead id' }, { status: 400 });

    const body = await request.json();
    const allowedFields: Record<string, unknown> = {};
    if (body.status) allowedFields.status = body.status;
    if (body.notes !== undefined) allowedFields.notes = body.notes;
    if (body.name !== undefined) allowedFields.name = body.name;
    allowedFields.updatedAt = new Date().toISOString();

    const updated = await updateDocument('leads', id, allowedFields);
    return NextResponse.json({ lead: updated });
  } catch (err) {
    console.error('[PATCH /api/leads/[id]]', err);
    return NextResponse.json({ error: 'Failed to update lead' }, { status: 500 });
  }
}
