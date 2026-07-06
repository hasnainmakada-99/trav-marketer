import { NextRequest, NextResponse } from 'next/server';
import { sendYCloudTextMessage } from '@/lib/whatsapp-ycloud';
import { createDocument, listDocuments, updateDocument } from '@/lib/appwrite';
import { Query } from 'node-appwrite';
import { sendLeadNotificationEmail } from '@/lib/email';

async function findOrCreateCustomer(phone: string, teamId: string) {
  const normalizedPhone = phone.replace(/[^\d]/g, '');
  const existing = await listDocuments('customers', [
    Query.equal('phone', normalizedPhone),
    Query.equal('teamId', teamId),
    Query.limit(1),
  ]);
  if (existing.documents.length > 0) {
    return existing.documents[0] as { $id: string; name?: string; email?: string };
  }
  return await createDocument('customers', {
    teamId,
    phone: normalizedPhone,
    name: `Caller ${normalizedPhone.slice(-4)}`,
    source: 'missed_call',
    createdAt: new Date().toISOString(),
  }) as unknown as { $id: string; name?: string; email?: string };
}

async function handleMissedCall(phone: string, teamId: string, callerName?: string) {
  const normalizedPhone = phone.replace(/[^\d]/g, '');
  const customer = await findOrCreateCustomer(normalizedPhone, teamId);
  const now = new Date().toISOString();

  // Look up ANY existing lead for this phone (not just source=missed_call)
  const leadData = await listDocuments('leads', [
    Query.equal('phone', normalizedPhone),
    Query.equal('teamId', teamId),
    Query.limit(1),
  ]);
  const existingLead = leadData.documents[0] as Record<string, any> | undefined;

  if (existingLead) {
    await updateDocument('leads', existingLead.$id, {
      notes: existingLead.notes
        ? `${existingLead.notes}\nMissed call — ${now}`
        : 'Missed call — auto-follow-up sent via WhatsApp',
      lastContactedAt: now,
      updatedAt: now,
    }).catch(() => {});
  } else {
    const newLead = await createDocument('leads', {
      teamId,
      phone: normalizedPhone,
      customerId: customer.$id,
      name: callerName || customer.name || null,
      source: 'missed_call',
      status: 'new_lead',
      notes: 'Missed call — auto-follow-up sent via WhatsApp',
      createdAt: now,
      updatedAt: now,
    }).catch(() => null);
    if (newLead) {
      sendLeadNotificationEmail({
        name: callerName || customer.name || null,
        phone: normalizedPhone,
        source: 'missed_call',
        notes: 'Missed call — auto-follow-up sent via WhatsApp',
      });
    }
  }

  const apiKey = (process.env.YCLOUD_API_KEY || '').trim();
  const fromPhone = (process.env.YCLOUD_WHATSAPP_FROM || '').trim();
  if (!apiKey || !fromPhone) {
    console.warn('[MissedCall] YCloud not configured, skipping WhatsApp send');
    return;
  }

  const name = callerName ? ` ${callerName.split(' ')[0]}` : '';
  const message = `Hi${name}! 👋 We missed your call, but we're here on WhatsApp!\n\nTell us what you're looking for — holiday packages, flights, or hotels — and we'll help you right away. 🌍✈️\n\n_Traventions — Your Travel Partner_`;

  const result = await sendYCloudTextMessage({
    apiKey,
    fromPhoneE164: fromPhone,
    toPhone: normalizedPhone,
    message,
  });

  if (result.success) {
    await createDocument('conversations', {
      teamId,
      customerId: customer.$id,
      phone: normalizedPhone,
      role: 'assistant',
      message,
      messageType: 'text',
      sentBy: 'ai',
      metaMessageId: result.messageId || null,
      deliveryStatus: 'sent',
      createdAt: now,
    });
    console.log(`[MissedCall] WhatsApp sent to ${normalizedPhone}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const callerPhone = body.phone || '';
    const callerName = body.name || null;
    const teamId = body.teamId || process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

    if (!callerPhone) {
      return NextResponse.json({ error: 'Missing caller phone number' }, { status: 400 });
    }

    await handleMissedCall(callerPhone, teamId, callerName || undefined);

    return NextResponse.json({
      success: true,
      message: 'Missed call processed. WhatsApp follow-up sent.',
    });
  } catch (error) {
    console.error('[MissedCall] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process missed call' },
      { status: 500 }
    );
  }
}
