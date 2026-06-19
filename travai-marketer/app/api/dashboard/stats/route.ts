import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { listDocuments } from '@/lib/appwrite';
import {
  CRM_STATUS_ORDER,
  buildPhoneVariants,
  buildStatusCounts,
  coerceLeadStatus,
  getDisplayName,
  normalizePhoneForMatch,
} from '@/lib/crm';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId') || TEAM_ID;
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [leadsAll, campaignsSent, reviewsReplied, recentConvos, customers] =
      await Promise.allSettled([
        listDocuments('leads', [Query.equal('teamId', teamId), Query.limit(500)]),
        listDocuments('campaigns', [
          Query.equal('teamId', teamId),
          Query.equal('status', 'sent'),
          Query.limit(1),
        ]),
        listDocuments('gbp_reviews', [
          Query.equal('teamId', teamId),
          Query.equal('replyStatus', 'replied'),
          Query.limit(1),
        ]),
        listDocuments('conversations', [
          Query.equal('teamId', teamId),
          Query.orderDesc('$createdAt'),
          Query.limit(300),
        ]),
        listDocuments('customers', [Query.equal('teamId', teamId), Query.limit(500)]),
      ]);

    const get = (result: PromiseSettledResult<{ total?: number; documents?: unknown[] }>) =>
      result.status === 'fulfilled' ? result.value : { total: 0, documents: [] };

    const allLeads = (get(leadsAll).documents || []) as Array<{
      $id?: string;
      phone?: string;
      name?: string | null;
      email?: string | null;
      status?: string | null;
      createdAt?: string;
      updatedAt?: string;
      $createdAt?: string;
    }>;
    const customerDocs = (get(customers).documents || []) as Array<{ phone?: string; name?: string | null }>;
    const customerByPhone = new Map<string, string>();
    for (const customer of customerDocs) {
      for (const variant of buildPhoneVariants(customer.phone)) {
        if (customer.name) {
          customerByPhone.set(variant, customer.name);
        }
      }
    }

    const uniqueLeadMap = new Map<string, (typeof allLeads)[number]>();
    for (const lead of allLeads) {
      const key = normalizePhoneForMatch(lead.phone) || lead.$id || String(Math.random());
      const existing = uniqueLeadMap.get(key);
      if (!existing) {
        uniqueLeadMap.set(key, lead);
        continue;
      }

      const existingStatusRank = CRM_STATUS_ORDER.indexOf(coerceLeadStatus(existing.status));
      const nextStatusRank = CRM_STATUS_ORDER.indexOf(coerceLeadStatus(lead.status));
      const existingTime = new Date(existing.updatedAt || existing.createdAt || existing.$createdAt || 0).getTime();
      const nextTime = new Date(lead.updatedAt || lead.createdAt || lead.$createdAt || 0).getTime();

      if (nextStatusRank > existingStatusRank || (nextStatusRank === existingStatusRank && nextTime > existingTime)) {
        uniqueLeadMap.set(key, lead);
      }
    }

    const normalizedLeads = Array.from(uniqueLeadMap.values()).map((lead) => ({
      ...lead,
      status: coerceLeadStatus(lead.status),
    }));
    const leadsByStatus = buildStatusCounts(normalizedLeads);

    const recentLeadDocs = [...normalizedLeads]
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || b.$createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || a.$createdAt || 0).getTime()
      )
      .slice(0, 5)
      .map((lead) => ({
        ...lead,
        status: coerceLeadStatus(lead.status),
        name:
          lead.name ||
          customerByPhone.get(buildPhoneVariants(lead.phone)[0] || '') ||
          lead.phone ||
          'Unknown',
      }));

    const conversationFeed = (get(recentConvos).documents || []) as Array<{
      $id: string;
      phone?: string;
      message?: string;
      role?: 'user' | 'assistant';
      sentBy?: 'customer' | 'ai' | 'staff';
      createdAt?: string;
      $createdAt?: string;
    }>;

    const latestConversationByPhone = new Map<
      string,
      {
        phone?: string;
        role?: 'user' | 'assistant';
        sentBy?: 'customer' | 'ai' | 'staff';
        createdAt?: string;
        $createdAt?: string;
      }
    >();

    for (const conversation of conversationFeed) {
      const normalizedPhone = normalizePhoneForMatch(conversation.phone);
      if (!normalizedPhone || latestConversationByPhone.has(normalizedPhone)) {
        continue;
      }
      latestConversationByPhone.set(normalizedPhone, conversation);
    }

    const activeConversationCount = Array.from(latestConversationByPhone.values()).filter(
      (conversation) => {
        const timestamp = conversation.createdAt || conversation.$createdAt || '';
        if (!timestamp || timestamp < since24h) {
          return false;
        }
        return conversation.role === 'user' || conversation.sentBy === 'customer';
      }
    ).length;

    const recentConversationDocs = conversationFeed.slice(0, 5).map((conversation) => ({
      ...conversation,
      name: getDisplayName({
        customerName: customerByPhone.get(buildPhoneVariants(conversation.phone)[0] || '') || null,
        phone: conversation.phone || null,
      }),
    }));

    return NextResponse.json({
      totalLeads: normalizedLeads.length,
      activeConversations: activeConversationCount,
      campaignsSent: get(campaignsSent).total ?? 0,
      reviewsReplied: get(reviewsReplied).total ?? 0,
      leadsByStatus,
      statusOrder: CRM_STATUS_ORDER,
      recentConversations: recentConversationDocs,
      recentLeads: recentLeadDocs,
    }, { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=20' } });
  } catch (err) {
    console.error('[Dashboard Stats] Error:', err);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
}
