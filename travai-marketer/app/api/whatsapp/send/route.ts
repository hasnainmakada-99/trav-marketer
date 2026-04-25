import { NextRequest, NextResponse } from 'next/server';
import { sendWhatsAppMessage, sendWhatsAppTemplate } from '@/lib/whatsapp';
import { createDocument, updateDocument } from '@/lib/appwrite';

/**
 * POST /api/whatsapp/send
 * Send a WhatsApp message to a customer
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      customerId,
      phone,
      message,
      templateName,
      templateParams,
      conversationId,
    } = body;

    // Validate required fields
    if (!phone || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: phone and message' },
        { status: 400 }
      );
    }

    // Get WhatsApp credentials from environment
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const whatsappToken = process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId || !whatsappToken) {
      return NextResponse.json(
        { error: 'WhatsApp credentials not configured' },
        { status: 500 }
      );
    }

    let result;

    // Send template or regular message
    if (templateName) {
      result = await sendWhatsAppTemplate({
        phoneNumberId,
        recipientPhone: phone,
        templateName,
        parameters: templateParams || [],
        whatsappToken,
      });
    } else {
      result = await sendWhatsAppMessage({
        phoneNumberId,
        recipientPhone: phone,
        message,
        whatsappToken,
      });
    }

    // Check if send was successful
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send message' },
        { status: 400 }
      );
    }

    // Save the message to database
    if (customerId) {
      try {
        await createDocument('conversations', {
          teamId: body.teamId || 'system',
          customerId: customerId,
          phone: phone,
          type: 'outgoing',
          messageType: 'text',
          text: message,
          mediaId: result.messageId,
          status: 'sent',
          timestamp: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });
      } catch (dbError) {
        console.error('Failed to save message to database:', dbError);
        // Don't fail the API call if database save fails
      }
    }

    return NextResponse.json(
      {
        success: true,
        messageId: result.messageId,
        phone: phone,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[WhatsApp Send] Error:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/whatsapp/send-bulk
 * Send messages to multiple customers (for campaigns)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      campaignId,
      recipients,
      message,
      templateName,
      templateParams,
      teamId,
    } = body;

    if (!recipients || !Array.isArray(recipients) || !message) {
      return NextResponse.json(
        { error: 'Invalid request format' },
        { status: 400 }
      );
    }

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const whatsappToken = process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId || !whatsappToken) {
      return NextResponse.json(
        { error: 'WhatsApp credentials not configured' },
        { status: 500 }
      );
    }

    const results = {
      sent: 0,
      failed: 0,
      errors: [] as any[],
    };

    // Send to each recipient
    for (const recipient of recipients) {
      try {
        let sendResult;

        if (templateName) {
          sendResult = await sendWhatsAppTemplate({
            phoneNumberId,
            recipientPhone: recipient.phone,
            templateName,
            parameters: templateParams || [],
            whatsappToken,
          });
        } else {
          sendResult = await sendWhatsAppMessage({
            phoneNumberId,
            recipientPhone: recipient.phone,
            message,
            whatsappToken,
          });
        }

        if (sendResult.success) {
          results.sent++;

          // Create campaign log entry
          if (campaignId) {
            await createDocument('campaign_logs', {
              teamId: teamId || 'system',
              campaignId: campaignId,
              phone: recipient.phone,
              customerId: recipient.customerId || '',
              status: 'sent',
              metaMessageId: sendResult.messageId,
              sentAt: new Date().toISOString(),
            });
          }
        } else {
          results.failed++;
          results.errors.push({
            phone: recipient.phone,
            error: sendResult.error,
          });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          phone: recipient.phone,
          error: String(error),
        });
      }

      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Update campaign status
    if (campaignId) {
      try {
        await updateDocument('campaigns', campaignId, {
          status: 'sent',
          sentAt: new Date().toISOString(),
          totalSent: results.sent,
        });
      } catch (error) {
        console.error('Failed to update campaign:', error);
      }
    }

    return NextResponse.json(
      {
        success: results.failed === 0,
        ...results,
        total: recipients.length,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[WhatsApp Bulk Send] Error:', error);
    return NextResponse.json(
      { error: 'Failed to send bulk messages' },
      { status: 500 }
    );
  }
}
