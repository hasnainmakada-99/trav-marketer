import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { listDocuments, createDocument } from '@/lib/appwrite';
import { queryLocalDocuments } from '@/lib/local-crm-cache';
import { buildBestLeadPreview, humanizeLeadNotes } from '@/lib/message-preview';
import { syncLeadStatusesFromConversations } from '@/lib/crm-sync';
import {
  CRM_STATUS_ORDER,
  buildPhoneVariants,
  coerceLeadStatus,
  getPreferredLeadName,
  normalizePhoneForMatch,
} from '@/lib/crm';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

async function listLeadPreviewConversations(params: {
  teamId: string;
  forceRemote: boolean;
  maxItems?: number;
}) {
  const pageSize = 1000;
  const maxItems = Math.max(pageSize, params.maxItems || 2500);
  const all: Array<Record<string, unknown>> = [];

  for (let offset = 0; offset < maxItems; offset += pageSize) {
    const result = await (params.forceRemote
      ? listDocuments('conversations', [
          Query.equal('teamId', params.teamId),
          Query.orderDesc('$createdAt'),
          Query.limit(pageSize),
          Query.offset(offset),
        ])
      : queryLocalDocuments('conversations', [
          Query.equal('teamId', params.teamId),
          Query.orderDesc('$createdAt'),
          Query.limit(pageSize),
          Query.offset(offset),
        ])).catch(() => ({ documents: [] as Array<Record<string, unknown>> }));

    const documents = (result.documents || []) as Array<Record<string, unknown>>;
    all.push(...documents);
    if (documents.length < pageSize) {
      break;
    }
  }

  return all;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      phone?: string; name?: string; email?: string;
      notes?: string; serviceInterest?: string; source?: string; teamId?: string;
    };
    const phone = (body.phone || '').replace(/[^\d+]/g, '').trim();
    if (!phone || phone.length < 8) {
      return NextResponse.json({ error: 'Valid phone number is required' }, { status: 400 });
    }
    const existing = await listDocuments('leads', [
      Query.equal('phone', phone),
      Query.equal('teamId', body.teamId || TEAM_ID),
      Query.limit(1),
    ]);

    if (existing.total > 0) {
      const existingLead = existing.documents[0];
      const updated = await updateDocument('leads', existingLead.$id, {
        name: body.name?.trim() || existingLead.name,
        email: body.email?.trim() || existingLead.email,
        lastContactedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return NextResponse.json({ lead: updated, updated: true }, { status: 200 });
    }

    const now = new Date().toISOString();
    const notes = [
      body.serviceInterest ? `Service Interest: ${body.serviceInterest}` : '',
      body.notes || '',
    ].filter(Boolean).join('\n') || null;

    const lead = await createDocument('leads', {
      teamId: body.teamId || TEAM_ID,
      phone,
      name: body.name?.trim() || null,
      email: body.email?.trim() || null,
      notes,
      source: body.source || 'walk_in',
      status: 'new_lead',
      lastContactedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ lead }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/leads]', err);
    return NextResponse.json({ error: 'Failed to create lead' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';
    const teamId = searchParams.get('teamId') || TEAM_ID;
    const refreshStatuses = searchParams.get('refreshStatuses') === '1';
    const forceRemote = searchParams.get('refresh') === '1' || refreshStatuses;
    const limit = Math.min(Number(searchParams.get('limit') || '100'), 200);
    const offset = Number(searchParams.get('offset') || '0');

    if (refreshStatuses) {
      await syncLeadStatusesFromConversations(teamId).catch((error) => {
        console.warn(
          '[GET /api/leads] Status refresh skipped:',
          error instanceof Error ? error.message : error
        );
      });
    }

    const queries = [
      Query.equal('teamId', teamId),
      Query.orderDesc('$createdAt'),
      Query.limit(limit),
      Query.offset(offset),
    ];
    if (status !== 'all') {
      queries.push(Query.equal('status', coerceLeadStatus(status)));
    }

    const result = forceRemote
      ? await listDocuments('leads', queries)
      : await queryLocalDocuments('leads', queries);

    // Enrich with customer names — leads only store names if AI extracted them from
    // conversation text; the customers collection gets updated as conversations grow.
    const phonesMissingName = (result.documents as Array<{ phone?: string; name?: string }>)
      .filter(l => !l.name && l.phone)
      .map(l => l.phone as string);

    const nameByPhone = new Map<string, string>();
    if (phonesMissingName.length > 0) {
      const customerQueries = [
        Query.equal(
          'phone',
          Array.from(new Set(phonesMissingName.flatMap((phone) => buildPhoneVariants(phone))))
        ),
        Query.limit(200),
      ];
      const custResult = await (forceRemote
        ? listDocuments('customers', customerQueries)
        : queryLocalDocuments('customers', customerQueries)
      ).catch(() => ({ documents: [] }));
      for (const c of custResult.documents as Array<{ phone?: string; name?: string }>) {
        if (c.phone && c.name) {
          for (const variant of buildPhoneVariants(c.phone)) {
            nameByPhone.set(variant, c.name);
          }
        }
      }
    }

    const dedupedLeads = new Map<string, Record<string, unknown>>();
    for (const lead of result.documents as Array<Record<string, unknown>>) {
      const key =
        normalizePhoneForMatch(lead.phone as string | null | undefined) ||
        String(lead.$id || Math.random());
      const existing = dedupedLeads.get(key);
      if (!existing) {
        dedupedLeads.set(key, lead);
        continue;
      }

      const existingRank = CRM_STATUS_ORDER.indexOf(coerceLeadStatus(existing.status as string | null));
      const nextRank = CRM_STATUS_ORDER.indexOf(coerceLeadStatus(lead.status as string | null));
      const existingTime = new Date(String(existing.updatedAt || existing.createdAt || existing.$createdAt || 0)).getTime();
      const nextTime = new Date(String(lead.updatedAt || lead.createdAt || lead.$createdAt || 0)).getTime();

      if (nextRank > existingRank || (nextRank === existingRank && nextTime > existingTime)) {
        dedupedLeads.set(key, lead);
      }
    }

    const leads = Array.from(dedupedLeads.values()).map(l => ({
      ...l,
      status: coerceLeadStatus(l.status as string | null),
      notes: humanizeLeadNotes(l.notes as string | null | undefined),
      name: getPreferredLeadName({
        leadName: l.name as string | null,
        customerName:
          nameByPhone.get((l.phone as string) || '') ||
          nameByPhone.get(buildPhoneVariants(l.phone as string)[0] || '') ||
          null,
        phone: l.phone as string | null,
      }),
    }));

    const recentConversationDocuments =
      leads.length > 0
        ? await listLeadPreviewConversations({
            teamId,
            forceRemote,
            maxItems: 2500,
          })
        : [];

    const conversationsByPhone = new Map<
      string,
      Array<{
        message?: string | null;
        messageType?: string | null;
        role?: 'user' | 'assistant' | null;
        sentBy?: 'customer' | 'ai' | 'staff' | null;
        createdAt?: string | null;
        $createdAt?: string | null;
      }>
    >();

    for (const conversation of recentConversationDocuments as Array<{
      phone?: string | null;
      message?: string | null;
      messageType?: string | null;
      role?: 'user' | 'assistant' | null;
      sentBy?: 'customer' | 'ai' | 'staff' | null;
      createdAt?: string | null;
      $createdAt?: string | null;
    }>) {
      const normalized = normalizePhoneForMatch(conversation.phone as string | null | undefined);
      if (!normalized) continue;
      const bucket = conversationsByPhone.get(normalized) || [];
      bucket.push(conversation);
      conversationsByPhone.set(normalized, bucket);
    }

    const enrichedLeads = leads.map((lead) => {
      const normalized = normalizePhoneForMatch((lead as Record<string, any>).phone as string | null | undefined);
      const preview = normalized
        ? buildBestLeadPreview(conversationsByPhone.get(normalized) || [])
        : null;
      return {
        ...lead,
        notes: preview || lead.notes || null,
      };
    });

    return NextResponse.json(
      { leads: enrichedLeads, total: enrichedLeads.length },
      { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=15' } }
    );
  } catch (err) {
    console.error('[GET /api/leads]', err);
    return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 });
  }
}
