import { NextRequest, NextResponse } from 'next/server';
import { syncLeadStatusesFromConversations } from '@/lib/crm-sync';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

export const maxDuration = 60;

/**
 * POST /api/leads/backfill
 * Rebuilds lead statuses from WhatsApp conversation history so old and new
 * chats share the same CRM pipeline.
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId') || TEAM_ID;
    const summary = await syncLeadStatusesFromConversations(teamId);
    return NextResponse.json({ success: true, teamId, ...summary });
  } catch (err) {
    console.error('[POST /api/leads/backfill]', err);
    return NextResponse.json({ error: 'Backfill failed' }, { status: 500 });
  }
}
