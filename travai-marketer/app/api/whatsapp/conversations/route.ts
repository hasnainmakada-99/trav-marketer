import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { listDocuments } from '@/lib/appwrite';

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
  teamId?: string;
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

/**
 * GET /api/whatsapp/conversations?teamId=...
 * Returns one row per phone number with last message + unread count.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId');
    const phone = searchParams.get('phone');

    if (!teamId) {
      return NextResponse.json({ error: 'teamId required' }, { status: 400 });
    }

    if (phone) {
      const result = await listDocuments('conversations', [
        Query.equal('teamId', teamId),
        Query.equal('phone', decodeURIComponent(phone)),
        Query.orderAsc('$createdAt'),
        Query.limit(500),
      ]);

      const messages = ((result.documents || []) as unknown as ThreadDoc[]).map(
        (doc) => {
          const isOutgoing =
            doc.role === 'assistant' || doc.sentBy === 'ai' || doc.sentBy === 'staff';
          return {
            $id: doc.$id,
            phone: doc.phone,
            type: (isOutgoing ? 'outgoing' : 'incoming') as 'incoming' | 'outgoing',
            messageType: doc.messageType || 'text',
            text: doc.message || null,
            status: doc.deliveryStatus || undefined,
            timestamp: doc.createdAt || doc.$createdAt || null,
            createdAt: doc.createdAt || doc.$createdAt || null,
          };
        }
      );

      return NextResponse.json({ phone: decodeURIComponent(phone), messages });
    }

    // Fetch latest 500 conversation rows for this team, newest first
    const convoResult = await listDocuments('conversations', [
      Query.equal('teamId', teamId),
      Query.orderDesc('$createdAt'),
      Query.limit(500),
    ]);

    const messages = (convoResult.documents || []) as unknown as ConversationDoc[];

    // Group by phone, keep first (newest) message per phone, count unread
    const byPhone = new Map<
      string,
      {
        phone: string;
        lastMessage: string;
        lastTimestamp: string;
        lastType: 'incoming' | 'outgoing';
        unreadCount: number;
      }
    >();

    for (const m of messages) {
      const phone = m.phone;
      if (!phone) continue;

      const isIncoming = m.role === 'user' || m.sentBy === 'customer';
      const ts = m.createdAt || m.$createdAt || new Date().toISOString();
      const normalizedMessage =
        m.message && m.message.trim().length > 0
          ? m.message
          : m.messageType === 'text'
          ? 'Text message'
          : `[${m.messageType || 'media'}]`;

      const existing = byPhone.get(phone);
      if (!existing) {
        byPhone.set(phone, {
          phone,
          lastMessage: normalizedMessage,
          lastTimestamp: ts,
          lastType: isIncoming ? 'incoming' : 'outgoing',
          unreadCount: isIncoming && m.deliveryStatus !== 'read' ? 1 : 0,
        });
      } else {
        if (isIncoming && m.deliveryStatus !== 'read') {
          existing.unreadCount += 1;
        }
      }
    }

    // Enrich with customer name
    const customerResult = await listDocuments('customers', [
      Query.equal('teamId', teamId),
      Query.limit(500),
    ]);
    const customers = (customerResult.documents || []) as unknown as CustomerDoc[];
    const nameByPhone = new Map(
      customers.map((c) => [c.phone || '', c.name || null])
    );

    const conversations = Array.from(byPhone.values())
      .map((c) => ({
        ...c,
        name: nameByPhone.get(c.phone) || null,
      }))
      .sort(
        (a, b) =>
          new Date(b.lastTimestamp).getTime() -
          new Date(a.lastTimestamp).getTime()
      );

    // 15 s browser cache — dashboard polls every 90 s so this just prevents
    // duplicate in-flight requests from multiple tabs/rapid navigation.
    return NextResponse.json(
      { conversations },
      { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=5' } }
    );
  } catch (error) {
    // Collection may not exist yet (fresh install) or have no data — return empty list.
    console.warn('[WA conversations] Returning empty list:', error instanceof Error ? error.message : error);
    return NextResponse.json({ conversations: [] });
  }
}
