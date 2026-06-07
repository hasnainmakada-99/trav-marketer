import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { createDocument, listDocuments, updateDocument } from '@/lib/appwrite';
import { buildPhoneVariants } from '@/lib/crm';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

function parseContactLine(line: string) {
  const cleaned = line.trim();
  if (!cleaned) return null;
  const parts = cleaned.split(/[,\t;|]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  if (/^name$/i.test(parts[0]) && /^phone$/i.test(parts[1])) return null;

  const phoneIndex = parts.findIndex((part) => /\d{8,}/.test(part.replace(/\D/g, '')));
  if (phoneIndex === -1) return null;

  const phone = parts[phoneIndex].replace(/\D/g, '');
  const email = parts.find((part) => /\S+@\S+\.\S+/.test(part)) || '';
  const name = parts
    .filter((_, index) => index !== phoneIndex)
    .filter((part) => part !== email)
    .join(' ')
    .trim();

  if (!phone) return null;
  return { name, phone, email };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { teamId?: string; contactsText?: string };
    const teamId = body.teamId || TEAM_ID;
    const contactsText = String(body.contactsText || '');
    const lines = contactsText.split(/\r?\n/);
    const contacts = lines.map(parseContactLine).filter(Boolean) as Array<{
      name: string;
      phone: string;
      email: string;
    }>;

    if (!contacts.length) {
      return NextResponse.json({ error: 'No valid contacts found' }, { status: 400 });
    }

    let created = 0;
    let updated = 0;
    for (const contact of contacts) {
      const variants = buildPhoneVariants(contact.phone);
      const existing = await listDocuments('customers', [
        Query.equal('teamId', teamId),
        Query.equal('phone', variants),
        Query.limit(1),
      ]).catch(() => ({ documents: [] as Array<Record<string, unknown>> }));
      const payload = {
        ...(contact.name ? { name: contact.name } : {}),
        ...(contact.email ? { email: contact.email } : {}),
        updatedAt: new Date().toISOString(),
      };

      const existingCustomer = existing.documents[0] as { $id?: string } | undefined;
      if (existingCustomer?.$id) {
        await updateDocument('customers', existingCustomer.$id, payload).catch(() => null);
        updated += 1;
      } else {
        await createDocument('customers', {
          teamId,
          phone: contact.phone,
          source: 'crm_contact_import',
          createdAt: new Date().toISOString(),
          ...payload,
        }).catch(() => null);
        created += 1;
      }

      const matchingLeads = await listDocuments('leads', [
        Query.equal('teamId', teamId),
        Query.equal('phone', variants),
        Query.limit(100),
      ]).catch(() => ({ documents: [] as Array<Record<string, unknown>> }));

      await Promise.all(
        matchingLeads.documents.map((lead) =>
          updateDocument('leads', String((lead as { $id?: string }).$id || ''), payload).catch(() => null)
        )
      );
    }

    return NextResponse.json({ created, updated, total: contacts.length });
  } catch (error) {
    console.error('[POST /api/customers/import]', error);
    return NextResponse.json({ error: 'Failed to import contacts' }, { status: 500 });
  }
}
