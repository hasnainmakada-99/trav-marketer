import { NextRequest, NextResponse } from 'next/server';
import { deleteDocument, updateDocument } from '@/lib/appwrite';
import { coerceLeadStatus } from '@/lib/crm';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Missing lead id' }, { status: 400 });

    const body = await request.json();
    const allowedFields: Record<string, unknown> = {};
    if (body.status) allowedFields.status = coerceLeadStatus(body.status);
    if (body.notes !== undefined) allowedFields.notes = body.notes;
    if (body.name !== undefined) allowedFields.name = body.name;
    if (body.email !== undefined) allowedFields.email = body.email;
    allowedFields.updatedAt = new Date().toISOString();

    const updated = await updateDocument('leads', id, allowedFields);
    return NextResponse.json({ lead: updated });
  } catch (err) {
    console.error('[PATCH /api/leads/[id]]', err);
    return NextResponse.json({ error: 'Failed to update lead' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Missing lead id' }, { status: 400 });
    await deleteDocument('leads', id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/leads/[id]]', err);
    return NextResponse.json({ error: 'Failed to delete lead' }, { status: 500 });
  }
}
