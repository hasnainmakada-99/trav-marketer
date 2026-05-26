import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { listDocuments } from '@/lib/appwrite';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';
    const limit = Math.min(Number(searchParams.get('limit') || '100'), 200);
    const offset = Number(searchParams.get('offset') || '0');

    // No teamId filter — this is an admin endpoint, show all leads
    const queries = [
      Query.orderDesc('$createdAt'),
      Query.limit(limit),
      Query.offset(offset),
    ];
    if (status !== 'all') {
      queries.push(Query.equal('status', status));
    }

    const result = await listDocuments('leads', queries);

    // Enrich with customer names — leads only store names if AI extracted them from
    // conversation text; the customers collection gets updated as conversations grow.
    const phonesMissingName = (result.documents as Array<{ phone?: string; name?: string }>)
      .filter(l => !l.name && l.phone)
      .map(l => l.phone as string);

    const nameByPhone = new Map<string, string>();
    if (phonesMissingName.length > 0) {
      const custResult = await listDocuments('customers', [
        Query.equal('phone', phonesMissingName),
        Query.limit(200),
      ]).catch(() => ({ documents: [] }));
      for (const c of custResult.documents as Array<{ phone?: string; name?: string }>) {
        if (c.phone && c.name) nameByPhone.set(c.phone, c.name);
      }
    }

    const leads = (result.documents as Array<Record<string, unknown>>).map(l => ({
      ...l,
      name: (l.name as string | null) || nameByPhone.get(l.phone as string) || null,
    }));

    return NextResponse.json(
      { leads, total: result.total },
      { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=15' } }
    );
  } catch (err) {
    console.error('[GET /api/leads]', err);
    return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 });
  }
}
