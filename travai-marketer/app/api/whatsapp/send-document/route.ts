import { NextRequest, NextResponse } from 'next/server';
import { sendYCloudDocumentMessage } from '@/lib/whatsapp-ycloud';
import { createDocument } from '@/lib/appwrite';

export async function POST(request: NextRequest) {
  try {
    const { teamId, phone, documentUrl, fileName, caption, customerId } = await request.json();
    const apiKey = (process.env.YCLOUD_API_KEY || '').trim();
    const fromPhone = (process.env.YCLOUD_WHATSAPP_FROM || '').trim();
    const normalizedPhone = String(phone || '').replace(/[^\d]/g, '');

    if (!apiKey || !fromPhone) {
      return NextResponse.json({ error: 'YCloud is not configured' }, { status: 500 });
    }
    if (!normalizedPhone) {
      return NextResponse.json({ error: 'Missing required field: phone' }, { status: 400 });
    }
    if (!documentUrl) {
      return NextResponse.json({ error: 'Missing required field: documentUrl' }, { status: 400 });
    }

    const result = await sendYCloudDocumentMessage({
      apiKey,
      fromPhoneE164: fromPhone,
      toPhone: normalizedPhone,
      documentUrl,
      fileName: fileName || undefined,
      caption: caption || undefined,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to send document' }, { status: 500 });
    }

    try {
      await createDocument('conversations', {
        teamId: teamId || 'system',
        customerId: customerId || 'manual',
        phone: normalizedPhone,
        role: 'assistant',
        message: caption ? `[Document] ${fileName || 'Document'}: ${caption}` : `[Document] ${fileName || 'Document'}`,
        messageType: 'document',
        sentBy: 'staff',
        metaMessageId: result.messageId || null,
        deliveryStatus: 'sent',
        createdAt: new Date().toISOString(),
      });
    } catch (dbError) {
      console.error('Failed to save document message to database:', dbError);
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      phone: normalizedPhone,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send document' },
      { status: 500 }
    );
  }
}
