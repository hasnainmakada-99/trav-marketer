import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { listDocuments } from '@/lib/appwrite';

interface ConversationDoc {
  $id: string;
  teamId: string;
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
 * GET /api/whatsapp/conversations/[phone]?teamId=...
 * Full thread with one customer phone, oldest first.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ phone: string }> | { phone: string } }
) {
  let decodedPhone = '';

  try {
    const routeParams = await Promise.resolve(context.params);
    const routePhone = routeParams?.phone || '';
    decodedPhone = routePhone ? decodeURIComponent(routePhone) : '';

    if (!decodedPhone) {
      const fromPath = request.nextUrl.pathname.split('/').pop() || '';
      decodedPhone = fromPath ? decodeURIComponent(fromPath) : '';
    }
    if (!decodedPhone) {
      const rawUrl = request.url || '';
      const marker = '/api/whatsapp/conversations/';
      const idx = rawUrl.indexOf(marker);
      if (idx >= 0) {
        const after = rawUrl.slice(idx + marker.length);
        const end = after.indexOf('?');
        const token = end >= 0 ? after.slice(0, end) : after;
        decodedPhone = token ? decodeURIComponent(token) : '';
      }
    }

    const teamId =
      request.nextUrl.searchParams.get('teamId') ||
      new URL(request.url).searchParams.get('teamId') ||
      process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID ||
      'system';

    if (!decodedPhone) {
      return NextResponse.json(
        { error: 'teamId and phone required' },
        { status: 400 }
      );
    }

    const result = await listDocuments('conversations', [
      Query.equal('teamId', teamId),
      Query.equal('phone', decodedPhone),
      Query.orderAsc('$createdAt'),
      Query.limit(500),
    ]);

    const messages = ((result.documents || []) as unknown as ConversationDoc[]).map(
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

    return NextResponse.json(
      {
        phone: decodedPhone,
        messages,
      },
      { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=10' } }
    );
  } catch (error) {
    // Collection may not exist yet; return empty thread.
    console.warn(
      '[WA thread] Returning empty thread:',
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { phone: decodedPhone, messages: [] },
      { headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=10' } }
    );
  }
}
