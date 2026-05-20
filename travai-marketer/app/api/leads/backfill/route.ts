import { NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { listDocuments, createDocument, updateDocument } from '@/lib/appwrite';

export const maxDuration = 60;

/**
 * POST /api/leads/backfill
 * Reads all customers that have at least one conversation and upserts a lead
 * record for each one. Safe to call repeatedly — existing leads are updated,
 * not duplicated.
 */
export async function POST() {
  try {
    let offset = 0;
    const batchSize = 100;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const customersResult = await listDocuments('customers', [
        Query.orderDesc('$createdAt'),
        Query.limit(batchSize),
        Query.offset(offset),
      ]).catch(() => ({ documents: [], total: 0 }));

      const customers = customersResult.documents as Array<{
        $id: string;
        teamId?: string;
        phone?: string;
        name?: string;
        email?: string;
      }>;

      if (customers.length === 0) break;

      for (const customer of customers) {
        const phone = customer.phone;
        if (!phone) { skipped++; continue; }

        const teamId = customer.teamId || process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'system';

        // Check if they have any conversations (i.e. actually messaged)
        const convCheck = await listDocuments('conversations', [
          Query.equal('customerId', customer.$id),
          Query.limit(1),
        ]).catch(() => ({ documents: [] }));

        if (convCheck.documents.length === 0) { skipped++; continue; }

        // Get their latest message for notes
        const latestConv = await listDocuments('conversations', [
          Query.equal('customerId', customer.$id),
          Query.equal('role', 'user'),
          Query.orderDesc('$createdAt'),
          Query.limit(1),
        ]).catch(() => ({ documents: [] }));

        const latestMsg = (latestConv.documents[0] as { message?: string } | undefined)?.message || '';
        const notes = latestMsg.slice(0, 300) || null;
        const now = new Date().toISOString();

        // Check if lead already exists for this phone
        const existingLead = await listDocuments('leads', [
          Query.equal('teamId', teamId),
          Query.equal('phone', phone),
          Query.limit(1),
        ]).catch(() => ({ documents: [] }));

        const lead = existingLead.documents[0] as { $id?: string } | undefined;

        if (lead?.$id) {
          await updateDocument('leads', lead.$id, {
            name: customer.name || undefined,
            email: customer.email || undefined,
            notes: notes || undefined,
            lastContactedAt: now,
            updatedAt: now,
          }).catch(() => {});
          updated++;
        } else {
          await createDocument('leads', {
            teamId,
            phone,
            name: customer.name || null,
            email: customer.email || null,
            source: 'whatsapp',
            status: 'new',
            notes,
            lastContactedAt: now,
            createdAt: now,
            updatedAt: now,
          }).catch(() => {});
          created++;
        }
      }

      if (customers.length < batchSize) break;
      offset += batchSize;
    }

    return NextResponse.json({ success: true, created, updated, skipped });
  } catch (err) {
    console.error('[POST /api/leads/backfill]', err);
    return NextResponse.json({ error: 'Backfill failed' }, { status: 500 });
  }
}
