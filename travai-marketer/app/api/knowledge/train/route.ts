import { NextRequest, NextResponse } from 'next/server';
import {
  getKnowledgeTrainingStatus,
  trainKnowledgeBase,
} from '@/lib/knowledge-training';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

export async function GET(request: NextRequest) {
  try {
    const teamId = request.nextUrl.searchParams.get('teamId') || TEAM_ID;
    const status = await getKnowledgeTrainingStatus(teamId);
    return NextResponse.json(status, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[Knowledge Train GET] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load knowledge status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { teamId?: string };
    const teamId = body.teamId || request.nextUrl.searchParams.get('teamId') || TEAM_ID;
    const result = await trainKnowledgeBase(teamId);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[Knowledge Train POST] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to train knowledge base' },
      { status: 500 }
    );
  }
}
