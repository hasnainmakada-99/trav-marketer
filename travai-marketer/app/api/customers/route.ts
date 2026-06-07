import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { createDocument, listDocuments, updateDocument } from '@/lib/appwrite';
import { buildPhoneVariants } from '@/lib/crm';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      teamId?: string;
      phone?: string;
      name?: string;
      email?: string;
    };

    const teamId = body.teamId || TEAM_ID;
    const normalizedPhone = String(body.phone || '').replace(/\D/g, '');
    if (!normalizedPhone) {
      return NextResponse.json({ error: 'Phone is required' }, { status: 400 });
    }

    const variants = buildPhoneVariants(normalizedPhone);
    const existingCustomers = await listDocuments('customers', [
      Query.equal('teamId', teamId),
      Query.equal('phone', variants),
      Query.limit(10),
    ]).catch(() => ({ documents: [] as Array<Record<string, unknown>> }));

    const payload = {
      name: body.name?.trim() || null,
      email: body.email?.trim() || null,
      updatedAt: new Date().toISOString(),
    };

    let customer;
    const existingCustomer = existingCustomers.documents[0] as { $id?: string } | undefined;
    if (existingCustomer?.$id) {
      customer = await updateDocument('customers', existingCustomer.$id, payload);
    } else {
      customer = await createDocument('customers', {
        teamId,
        phone: normalizedPhone,
        source: 'crm_contact_sync',
        createdAt: new Date().toISOString(),
        ...payload,
      });
    }

    const matchingLeads = await listDocuments('leads', [
      Query.equal('teamId', teamId),
      Query.equal('phone', variants),
      Query.limit(100),
    ]).catch(() => ({ documents: [] as Array<Record<string, unknown>> }));

    await Promise.all(
      matchingLeads.documents.map((lead) =>
        updateDocument('leads', String((lead as { $id?: string }).$id || ''), {
          ...(payload.name ? { name: payload.name } : {}),
          ...(payload.email ? { email: payload.email } : {}),
          updatedAt: new Date().toISOString(),
        }).catch(() => null)
      )
    );

    return NextResponse.json({ customer });
  } catch (error) {
    console.error('[PUT /api/customers]', error);
    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 });
  }
}
