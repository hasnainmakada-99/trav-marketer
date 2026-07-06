import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { listDocuments } from '@/lib/appwrite';
import { queryLocalDocuments } from '@/lib/local-crm-cache';
import { getContactDisplayLabel } from '@/lib/contact-identity';
import { humanizeMessagePreview } from '@/lib/message-preview';
import {
  CRM_STATUS_ORDER,
  buildPhoneVariants,
  buildStatusCounts,
  coerceLeadStatus,
  normalizePhoneForMatch,
} from '@/lib/crm';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';
const DASHBOARD_STATS_CACHE_TTL_MS = Number(process.env.DASHBOARD_STATS_CACHE_TTL_MS || `${15 * 60 * 1000}`);

const statsCache = new Map<
  string,
  {
    expiresAt: number;
    payload: unknown;
  }
>();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId') || TEAM_ID;
    const refresh = searchParams.get('refresh') === '1';
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const cached = statsCache.get(teamId);
    if (!refresh && cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload, {
        headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
      });
    }

    const readDocuments = refresh ? listDocuments : queryLocalDocuments;
    const [leadsAll, campaignsSent, reviewsReplied, recentConvos, customers, transactions] =
      await Promise.allSettled([
        readDocuments('leads', [Query.equal('teamId', teamId), Query.limit(150)]),
        readDocuments('campaigns', [
          Query.equal('teamId', teamId),
          Query.equal('status', 'sent'),
          Query.limit(1),
        ]),
        readDocuments('gbp_reviews', [
          Query.equal('teamId', teamId),
          Query.equal('replyStatus', 'replied'),
          Query.limit(1),
        ]),
        readDocuments('conversations', [
          Query.equal('teamId', teamId),
          Query.orderDesc('$createdAt'),
          Query.limit(80),
        ]),
        readDocuments('customers', [Query.equal('teamId', teamId), Query.limit(150)]),
        readDocuments('transactions', [Query.equal('teamId', teamId), Query.limit(200)]),
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
        name: getContactDisplayLabel({
          customerName: customerByPhone.get(buildPhoneVariants(lead.phone)[0] || '') || null,
          leadName: lead.name || null,
          phone: lead.phone || null,
          source: (lead as { source?: string | null }).source || 'whatsapp',
        }),
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
      message: humanizeMessagePreview(conversation.message, {
        direction:
          conversation.role === 'user' || conversation.sentBy === 'customer'
            ? 'incoming'
            : 'outgoing',
      }),
      name: getContactDisplayLabel({
        customerName: customerByPhone.get(buildPhoneVariants(conversation.phone)[0] || '') || null,
        phone: conversation.phone || null,
        source: 'whatsapp',
      }),
    }));

    const transactionDocs = (get(transactions).documents || []) as Array<{
      amount?: number;
      status?: string;
      date?: string;
      service?: string;
      customerName?: string | null;
    }>;

    let totalRevenue = 0;
    let monthlyRevenue = 0;
    const currentMonth = new Date().toISOString().slice(0, 7);
    const revenueByService: Record<string, number> = {};

    for (const tx of transactionDocs) {
      if (tx.status === 'completed' || !tx.status) {
        const amount = Number(tx.amount) || 0;
        totalRevenue += amount;
        if (tx.date && tx.date.startsWith(currentMonth)) {
          monthlyRevenue += amount;
        }
        const service = tx.service || 'General';
        revenueByService[service] = (revenueByService[service] || 0) + amount;
      }
    }

    const payload = {
      totalLeads: normalizedLeads.length,
      activeConversations: activeConversationCount,
      campaignsSent: get(campaignsSent).total ?? 0,
      reviewsReplied: get(reviewsReplied).total ?? 0,
      leadsByStatus,
      statusOrder: CRM_STATUS_ORDER,
      recentConversations: recentConversationDocs,
      recentLeads: recentLeadDocs,
      revenue: {
        total: totalRevenue,
        monthly: monthlyRevenue,
        byService: revenueByService,
        transactionCount: transactionDocs.length,
      },
    };

    statsCache.set(teamId, {
      expiresAt:
        Date.now() +
        (payload.totalLeads || payload.activeConversations || payload.campaignsSent || payload.reviewsReplied
          ? Math.max(60_000, DASHBOARD_STATS_CACHE_TTL_MS)
          : 60_000),
      payload,
    });

    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' } });
  } catch (err) {
    console.error('[Dashboard Stats] Error:', err);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
}
