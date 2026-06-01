import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { listDocuments } from '@/lib/appwrite';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId') || TEAM_ID;
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      leadsAll,
      leadsNew,
      leadsContacted,
      leadsConverted,
      leadsClosed,
      activeConvos,
      campaignsSent,
      reviewsReplied,
      recentConvos,
      recentLeads,
    ] = await Promise.allSettled([
      listDocuments('leads', [Query.equal('teamId', teamId), Query.limit(1)]),
      listDocuments('leads', [Query.equal('teamId', teamId), Query.equal('status', 'new'), Query.limit(1)]),
      listDocuments('leads', [Query.equal('teamId', teamId), Query.equal('status', 'contacted'), Query.limit(1)]),
      listDocuments('leads', [Query.equal('teamId', teamId), Query.equal('status', 'converted'), Query.limit(1)]),
      listDocuments('leads', [Query.equal('teamId', teamId), Query.equal('status', 'closed'), Query.limit(1)]),
      listDocuments('conversations', [
        Query.equal('teamId', teamId),
        Query.equal('sentBy', 'customer'),
        Query.greaterThan('$createdAt', since24h),
        Query.limit(1),
      ]),
      listDocuments('campaigns', [Query.equal('teamId', teamId), Query.equal('status', 'sent'), Query.limit(1)]),
      listDocuments('gbp_reviews', [Query.equal('teamId', teamId), Query.equal('replyStatus', 'replied'), Query.limit(1)]),
      listDocuments('conversations', [
        Query.equal('teamId', teamId),
        Query.orderDesc('$createdAt'),
        Query.limit(5),
      ]),
      listDocuments('leads', [
        Query.equal('teamId', teamId),
        Query.orderDesc('$createdAt'),
        Query.limit(5),
      ]),
    ]);

    const get = (r: PromiseSettledResult<{ total?: number; documents?: unknown[] }>) =>
      r.status === 'fulfilled' ? r.value : { total: 0, documents: [] };

    const totalLeads = (get(leadsAll) as { total?: number }).total ?? 0;

    return NextResponse.json({
      totalLeads,
      activeConversations: (get(activeConvos) as { total?: number }).total ?? 0,
      campaignsSent: (get(campaignsSent) as { total?: number }).total ?? 0,
      reviewsReplied: (get(reviewsReplied) as { total?: number }).total ?? 0,
      leadsByStatus: {
        new: (get(leadsNew) as { total?: number }).total ?? 0,
        contacted: (get(leadsContacted) as { total?: number }).total ?? 0,
        converted: (get(leadsConverted) as { total?: number }).total ?? 0,
        closed: (get(leadsClosed) as { total?: number }).total ?? 0,
      },
      recentConversations: (get(recentConvos) as { documents?: unknown[] }).documents ?? [],
      recentLeads: (get(recentLeads) as { documents?: unknown[] }).documents ?? [],
    });
  } catch (err) {
    console.error('[Dashboard Stats] Error:', err);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
}
