import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'appwrite';
import { listDocuments } from '@/lib/appwrite';

interface ConversationDoc {
  $id: string;
  teamId: string;
  customerId?: string;
  phone: string;
  type: 'incoming' | 'outgoing';
  messageType?: string;
  text?: string | null;
  status?: string;
  timestamp?: string;
  createdAt?: string;
  readAt?: string | null;
}

interface CustomerDoc {
  $id: string;
  phone?: string;
  name?: string | null;
  teamId?: string;
}

/**
 * GET /api/whatsapp/conversations?teamId=...
 * Returns one row per phone number with last message + unread count.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId');

    if (!teamId) {
      return NextResponse.json({ error: 'teamId required' }, { status: 400 });
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

      const existing = byPhone.get(phone);
      const ts = m.timestamp || m.createdAt || new Date().toISOString();

      if (!existing) {
        byPhone.set(phone, {
          phone,
          lastMessage: m.text || `[${m.messageType || 'media'}]`,
          lastTimestamp: ts,
          lastType: m.type,
          unreadCount:
            m.type === 'incoming' && !m.readAt && m.status !== 'read' ? 1 : 0,
        });
      } else {
        if (m.type === 'incoming' && !m.readAt && m.status !== 'read') {
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

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('[WA conversations] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}
