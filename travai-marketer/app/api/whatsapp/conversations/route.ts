import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { listDocuments } from '@/lib/appwrite';
import { queryLocalDocuments } from '@/lib/local-crm-cache';
import { getContactDisplayLabel } from '@/lib/contact-identity';
import { humanizeLeadNotes, humanizeMessagePreview } from '@/lib/message-preview';
import {
  buildPhoneVariants,
  buildStatusCounts,
  coerceLeadStatus,
  normalizePhoneForMatch,
  type CrmLeadStatus,
} from '@/lib/crm';

interface ConversationDoc {
  $id: string;
  $createdAt?: string;
  teamId: string;
  customerId?: string;
  phone: string;
  role?: 'user' | 'assistant';
  message?: string | null;
  messageType?: string;
  sentBy?: 'customer' | 'ai' | 'staff';
  metaMessageId?: string | null;
  deliveryStatus?: string;
  createdAt?: string;
}

interface CustomerDoc {
  $id: string;
  phone?: string;
  name?: string | null;
  email?: string | null;
  teamId?: string;
}

interface LeadDoc {
  $id: string;
  phone?: string;
  name?: string | null;
  email?: string | null;
  status?: string | null;
  notes?: string | null;
  source?: string | null;
  teamId?: string;
  updatedAt?: string;
  createdAt?: string;
  $createdAt?: string;
  $updatedAt?: string;
}

interface ThreadDoc {
  $id: string;
  phone: string;
  role?: 'user' | 'assistant';
  sentBy?: 'customer' | 'ai' | 'staff';
  message?: string | null;
  messageType?: string;
  deliveryStatus?: string;
  createdAt?: string;
  $createdAt?: string;
}

function formatPreview(message?: string | null, messageType?: string) {
  return humanizeMessagePreview(message, { messageType });
}

function buildContactMaps(customers: CustomerDoc[], leads: LeadDoc[]) {
  const customerByPhone = new Map<string, CustomerDoc>();
  const leadByPhone = new Map<string, LeadDoc>();

  for (const customer of customers) {
    for (const variant of buildPhoneVariants(customer.phone)) {
      if (!customerByPhone.has(variant)) {
        customerByPhone.set(variant, customer);
      }
    }
  }

  for (const lead of leads) {
    for (const variant of buildPhoneVariants(lead.phone)) {
      if (!leadByPhone.has(variant)) {
        leadByPhone.set(variant, lead);
      }
    }
  }

  return { customerByPhone, leadByPhone };
}

function resolveContact(phone: string, maps: ReturnType<typeof buildContactMaps>) {
  const normalized = normalizePhoneForMatch(phone);
  const customer = maps.customerByPhone.get(normalized);
  const lead = maps.leadByPhone.get(normalized);

  return {
    customer,
    lead,
    displayName: getContactDisplayLabel({
      customerName: customer?.name || null,
      leadName: lead?.name || null,
      phone,
      source: lead?.source || 'whatsapp',
    }),
    email: customer?.email || lead?.email || null,
    status: coerceLeadStatus(lead?.status),
    source: lead?.source || null,
    notes: humanizeLeadNotes(lead?.notes || null),
  };
}

/**
 * GET /api/whatsapp/conversations?teamId=...
 * Returns one row per phone number with last message + unread count.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId');
    const phone = searchParams.get('phone');
    const refresh = searchParams.get('refresh') === '1';

    if (!teamId) {
      return NextResponse.json({ error: 'teamId required' }, { status: 400 });
    }

    const readDocuments = refresh ? listDocuments : queryLocalDocuments;

    const [customerResult, leadResult] = await Promise.all([
      readDocuments('customers', [Query.equal('teamId', teamId), Query.limit(500)]).catch(() => ({
        documents: [] as CustomerDoc[],
      })),
      readDocuments('leads', [Query.equal('teamId', teamId), Query.limit(500)]).catch(() => ({
        documents: [] as LeadDoc[],
      })),
    ]);

    const contactMaps = buildContactMaps(
      (customerResult.documents || []) as unknown as CustomerDoc[],
      (leadResult.documents || []) as unknown as LeadDoc[]
    );

    if (phone) {
      const decodedPhone = decodeURIComponent(phone);
      const result = await readDocuments('conversations', [
        Query.equal('teamId', teamId),
        Query.equal('phone', buildPhoneVariants(decodedPhone)),
        Query.orderAsc('$createdAt'),
        Query.limit(500),
      ]);
      const contact = resolveContact(decodedPhone, contactMaps);

      const messages = ((result.documents || []) as unknown as ThreadDoc[]).map((doc) => {
        const isOutgoing =
          doc.role === 'assistant' || doc.sentBy === 'ai' || doc.sentBy === 'staff';
        return {
          $id: doc.$id,
          phone: doc.phone,
          type: (isOutgoing ? 'outgoing' : 'incoming') as 'incoming' | 'outgoing',
          messageType: doc.messageType || 'text',
          text: humanizeMessagePreview(doc.message || null, {
            messageType: doc.messageType,
            direction: isOutgoing ? 'outgoing' : 'incoming',
          }),
          status: doc.deliveryStatus || undefined,
          timestamp: doc.createdAt || doc.$createdAt || null,
          createdAt: doc.createdAt || doc.$createdAt || null,
        };
      });

      return NextResponse.json({
        phone: decodedPhone,
        name: contact.displayName,
        email: contact.email,
        crmStatus: contact.status,
        notes: contact.notes,
        messages,
      }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
    }

    const convoResult = await readDocuments('conversations', [
      Query.equal('teamId', teamId),
      Query.orderDesc('$createdAt'),
      Query.limit(500),
    ]);

    const messages = (convoResult.documents || []) as unknown as ConversationDoc[];
    const byPhone = new Map<
      string,
      {
        phone: string;
        name: string;
        email: string | null;
        crmStatus: CrmLeadStatus;
        source: string | null;
        lastMessage: string;
        lastTimestamp: string;
        lastType: 'incoming' | 'outgoing';
        unreadCount: number;
        awaitingReply: boolean;
      }
    >();

    for (const message of messages) {
      const convoPhone = message.phone;
      if (!convoPhone) continue;
      const phoneKey = normalizePhoneForMatch(convoPhone) || convoPhone;

      const isIncoming = message.role === 'user' || message.sentBy === 'customer';
      const ts = message.createdAt || message.$createdAt || new Date().toISOString();
      const contact = resolveContact(convoPhone, contactMaps);

      const existing = byPhone.get(phoneKey);
      if (!existing) {
        byPhone.set(phoneKey, {
          phone: convoPhone,
          name: contact.displayName,
          email: contact.email,
          crmStatus: contact.status,
          source: contact.source,
          lastMessage: formatPreview(message.message, message.messageType),
          lastTimestamp: ts,
          lastType: isIncoming ? 'incoming' : 'outgoing',
          unreadCount: isIncoming ? 1 : 0,
          awaitingReply: isIncoming,
        });
      } else if (existing.awaitingReply && isIncoming) {
        existing.unreadCount += 1;
      } else if (!isIncoming) {
        existing.awaitingReply = false;
      }
    }

    // Merge leads without any WhatsApp conversation into the inbox
    const leadDocs = (leadResult.documents || []) as unknown as LeadDoc[];
    for (const lead of leadDocs) {
      if (!lead.phone) continue;
      const phoneKey = normalizePhoneForMatch(lead.phone) || lead.phone;
      if (byPhone.has(phoneKey)) continue;

      const customer = contactMaps.customerByPhone.get(phoneKey);
      const leadName = lead.name || lead.phone;
      byPhone.set(phoneKey, {
        phone: lead.phone,
        name: customer?.name || leadName,
        email: customer?.email || lead.email || null,
        crmStatus: coerceLeadStatus(lead.status),
        source: lead.source || 'unknown',
        lastMessage: 'No messages yet',
        lastTimestamp: lead.updatedAt || lead.createdAt || new Date().toISOString(),
        lastType: 'outgoing',
        unreadCount: 0,
        awaitingReply: false,
      });
    }

    const conversations = Array.from(byPhone.values())
      .map((conversation) => ({
        phone: conversation.phone,
        name: conversation.name,
        email: conversation.email,
        crmStatus: conversation.crmStatus,
        source: conversation.source,
        lastMessage: conversation.lastMessage,
        lastTimestamp: conversation.lastTimestamp,
        lastType: conversation.lastType,
        unreadCount: conversation.unreadCount,
      }))
      .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());

    return NextResponse.json(
      {
        conversations,
        statusCounts: buildStatusCounts(conversations.map((conversation) => ({ status: conversation.crmStatus }))),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.warn(
      '[WA conversations] Returning empty list:',
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({
      conversations: [],
      statusCounts: buildStatusCounts([]),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  }
}
