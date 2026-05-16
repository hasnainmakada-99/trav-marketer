import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { listDocuments } from '@/lib/appwrite';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId') || process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'system';
    const status = searchParams.get('status') || 'all';
    const limit = Math.min(Number(searchParams.get('limit') || '50'), 100);
    const offset = Number(searchParams.get('offset') || '0');

    const queries = [
      Query.equal('teamId', teamId),
      Query.orderDesc('$createdAt'),
      Query.limit(limit),
      Query.offset(offset),
    ];
    if (status !== 'all') {
      queries.push(Query.equal('status', status));
    }

    const result = await listDocuments('leads', queries);
    return NextResponse.json({ leads: result.documents, total: result.total });
  } catch (err) {
    console.error('[GET /api/leads]', err);
    return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 });
  }
}
