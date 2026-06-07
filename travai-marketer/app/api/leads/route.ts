import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { listDocuments, createDocument } from '@/lib/appwrite';
import { syncLeadStatusesFromConversations } from '@/lib/crm-sync';
import { CRM_STATUS_ORDER, buildPhoneVariants, coerceLeadStatus, normalizePhoneForMatch } from '@/lib/crm';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

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
    const limit = Math.min(Number(searchParams.get('limit') || '100'), 200);
    const offset = Number(searchParams.get('offset') || '0');

    await syncLeadStatusesFromConversations(teamId).catch(() => null);

    const queries = [
      Query.equal('teamId', teamId),
      Query.orderDesc('$createdAt'),
      Query.limit(limit),
      Query.offset(offset),
    ];
    if (status !== 'all') {
      queries.push(Query.equal('status', coerceLeadStatus(status)));
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
        Query.equal(
          'phone',
          Array.from(new Set(phonesMissingName.flatMap((phone) => buildPhoneVariants(phone))))
        ),
        Query.limit(200),
      ]).catch(() => ({ documents: [] }));
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
      name:
        (l.name as string | null) ||
        nameByPhone.get((l.phone as string) || '') ||
        nameByPhone.get(buildPhoneVariants(l.phone as string)[0] || '') ||
        null,
    }));

    return NextResponse.json(
      { leads, total: leads.length },
      { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=15' } }
    );
  } catch (err) {
    console.error('[GET /api/leads]', err);
    return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 });
  }
}
