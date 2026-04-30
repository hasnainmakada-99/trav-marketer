import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'appwrite';
import { listDocuments } from '@/lib/appwrite';

interface ConversationDoc {
  $id: string;
  teamId: string;
  phone: string;
  type: 'incoming' | 'outgoing';
  messageType?: string;
  text?: string | null;
  status?: string;
  timestamp?: string;
  createdAt?: string;
}

/**
 * GET /api/whatsapp/conversations/[phone]?teamId=...
 * Full thread with one customer phone, oldest first.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ phone: string }> }
) {
  try {
    const { phone } = await params;
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId');

    if (!teamId || !phone) {
      return NextResponse.json(
        { error: 'teamId and phone required' },
        { status: 400 }
      );
    }

    const decodedPhone = decodeURIComponent(phone);

    const result = await listDocuments('conversations', [
      Query.equal('teamId', teamId),
      Query.equal('phone', decodedPhone),
      Query.orderAsc('$createdAt'),
      Query.limit(500),
    ]);

    return NextResponse.json({
      phone: decodedPhone,
      messages: (result.documents || []) as unknown as ConversationDoc[],
    });
  } catch (error) {
    console.error('[WA thread] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}
