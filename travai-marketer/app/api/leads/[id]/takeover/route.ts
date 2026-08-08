import { NextRequest, NextResponse } from 'next/server';
import { updateDocument } from '@/lib/appwrite';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { human_takeover, taken_over_by } = body;

    if (typeof human_takeover !== 'boolean') {
      return NextResponse.json(
        { error: 'human_takeover must be boolean' },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {
      human_takeover,
      updatedAt: new Date().toISOString(),
    };

    if (taken_over_by) {
      updateData.taken_over_by = taken_over_by;
      updateData.taken_over_at = new Date().toISOString();
    }

    const updated = await updateDocument('leads', params.id, updateData);

    return NextResponse.json({ success: true, lead: updated });
  } catch (error) {
    console.error('[Lead Takeover] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update lead takeover status' },
      { status: 500 }
    );
  }
}