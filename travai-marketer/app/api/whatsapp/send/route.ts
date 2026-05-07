import { NextRequest, NextResponse } from 'next/server';
import { sendWhatsAppMessage, sendWhatsAppTemplate } from '@/lib/whatsapp';
import { createDocument, getDocument, updateDocument } from '@/lib/appwrite';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBridgeCommandResult(commandId: string, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const doc = (await getDocument('bridge_commands', commandId)) as {
        status?: string;
        message?: string | null;
      };
      if (doc.status === 'completed' || doc.status === 'failed') {
        return { status: doc.status, message: doc.message || null };
      }
    } catch {
      // command doc may not be visible instantly; keep polling
    }
    await sleep(450);
  }
  return { status: 'pending', message: null };
}

function parseButtons(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .slice(0, 3);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return parseButtons(parsed);
    } catch {
      return raw
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 3);
    }
  }
  return [];
}

function applyTemplateParams(text: string, params: string[]) {
  if (!text) return '';
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, indexText: string) => {
    const index = Number(indexText) - 1;
    if (!Number.isFinite(index) || index < 0) return '';
    return params[index] || '';
  });
}

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
      localTemplateId,
    } = body;

    // Validate required fields
    if (!phone || (!message && !templateName && !localTemplateId)) {
      return NextResponse.json(
        { error: 'Missing required fields: phone and message/templateName/localTemplateId' },
        { status: 400 }
      );
    }

    const bridgeModeEnabled = Boolean(process.env.BRIDGE_SHARED_SECRET);
    const normalizedPhone = String(phone || '').replace(/[^\d]/g, '');
    const normalizedMessage = String(message || '').trim();
    const normalizedParams = Array.isArray(templateParams)
      ? templateParams.map((p: unknown) => String(p || '').trim()).filter(Boolean)
      : [];
    const teamId = body.teamId || 'system';

    if (localTemplateId && bridgeModeEnabled) {
      const localTemplate = (await getDocument(
        'wa_local_templates',
        String(localTemplateId)
      )) as {
        teamId?: string;
        name?: string;
        body?: string;
        buttons?: string | null;
      };

      if (!localTemplate?.body) {
        return NextResponse.json({ error: 'Local template not found' }, { status: 404 });
      }
      if (localTemplate.teamId && localTemplate.teamId !== teamId) {
        return NextResponse.json(
          { error: 'Local template team mismatch' },
          { status: 403 }
        );
      }

      const renderedBody = applyTemplateParams(
        String(localTemplate.body || ''),
        normalizedParams
      ).trim();
      const buttonLabels = parseButtons(localTemplate.buttons || null)
        .map((btn) => applyTemplateParams(btn, normalizedParams).trim())
        .filter(Boolean)
        .slice(0, 3);

      if (!renderedBody) {
        return NextResponse.json(
          { error: 'Rendered local template body is empty' },
          { status: 400 }
        );
      }

      const controlUrl = new URL('/api/wa-bridge/control', request.url);
      const controlRes = await fetch(controlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          action: 'send_template',
          payload: {
            phone: normalizedPhone,
            message: renderedBody,
            buttons: buttonLabels,
            customerId: customerId || 'manual',
          },
        }),
      });
      const controlData = await controlRes.json();
      if (!controlRes.ok) {
        return NextResponse.json(
          { error: controlData?.error || 'Failed to queue local template send' },
          { status: 400 }
        );
      }
      const commandId = String(controlData?.commandId || '');
      const commandResult = commandId
        ? await waitForBridgeCommandResult(commandId, 7000)
        : { status: 'pending', message: null };
      if (commandResult.status === 'failed') {
        return NextResponse.json(
          {
            error:
              commandResult.message ||
              'Bridge failed to send local template. Restart bridge and try again.',
          },
          { status: 400 }
        );
      }

      try {
        await createDocument('conversations', {
          teamId,
          customerId: customerId || 'manual',
          phone: normalizedPhone,
          role: 'assistant',
          message: renderedBody,
          messageType: 'template',
          sentBy: 'staff',
          metaMessageId: commandId || null,
          deliveryStatus:
            commandResult.status === 'completed' ? 'bridged' : 'queued',
          createdAt: new Date().toISOString(),
        });
      } catch (dbError) {
        console.error('Failed to save local template message to database:', dbError);
      }

      return NextResponse.json(
        {
          success: true,
          mode: 'bridge_local_template',
          queued: commandResult.status !== 'completed',
          commandId: commandId || null,
          phone: normalizedPhone,
          status: commandResult.status,
          timestamp: new Date().toISOString(),
        },
        { status: 200 }
      );
    }

    // Bridge mode for text sends (dashboard/live chat) so it works with WA Web linked number.
    if (!templateName && bridgeModeEnabled) {
      const controlUrl = new URL('/api/wa-bridge/control', request.url);
      const controlRes = await fetch(controlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          action: 'send_text',
          payload: {
            phone: normalizedPhone,
            message: normalizedMessage,
            customerId: customerId || 'manual',
          },
        }),
      });
      const controlData = await controlRes.json();
      if (!controlRes.ok) {
        return NextResponse.json(
          { error: controlData?.error || 'Failed to queue bridge send' },
          { status: 400 }
        );
      }
      const commandId = String(controlData?.commandId || '');
      const commandResult = commandId
        ? await waitForBridgeCommandResult(commandId, 6500)
        : { status: 'pending', message: null };
      if (commandResult.status === 'failed') {
        return NextResponse.json(
          {
            error:
              commandResult.message ||
              'Bridge failed to send message. Restart bridge and try again.',
          },
          { status: 400 }
        );
      }

      try {
        await createDocument('conversations', {
          teamId,
          customerId: customerId || 'manual',
          phone: normalizedPhone,
          role: 'assistant',
          message: normalizedMessage,
          messageType: 'text',
          sentBy: 'staff',
          metaMessageId: commandId || null,
          deliveryStatus:
            commandResult.status === 'completed' ? 'bridged' : 'queued',
          createdAt: new Date().toISOString(),
        });
      } catch (dbError) {
        console.error('Failed to save bridge message to database:', dbError);
      }

      return NextResponse.json(
        {
          success: true,
          mode: 'bridge',
          queued: commandResult.status !== 'completed',
          commandId: commandId || null,
          phone: normalizedPhone,
          status: commandResult.status,
          timestamp: new Date().toISOString(),
        },
        { status: 200 }
      );
    }

    // Get WhatsApp credentials from environment
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const whatsappToken = process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId || !whatsappToken) {
      return NextResponse.json(
        {
          error:
            'WhatsApp Cloud API is not configured. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN.',
        },
        { status: 500 }
      );
    }

    let result;

    // Send template or regular message
    if (templateName) {
      result = await sendWhatsAppTemplate({
        phoneNumberId,
        recipientPhone: normalizedPhone,
        templateName,
        parameters: templateParams || [],
        whatsappToken,
      });
    } else {
      result = await sendWhatsAppMessage({
        phoneNumberId,
        recipientPhone: normalizedPhone,
        message: normalizedMessage,
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
    try {
      await createDocument('conversations', {
        teamId,
        customerId: customerId || 'manual',
        phone: normalizedPhone,
        role: 'assistant',
        message: templateName
          ? `[template: ${templateName}]`
          : normalizedMessage,
        messageType: templateName ? 'template' : 'text',
        sentBy: 'staff',
        metaMessageId: result.messageId || null,
        deliveryStatus: 'sent',
        createdAt: new Date().toISOString(),
      });
    } catch (dbError) {
      console.error('Failed to save message to database:', dbError);
      // Don't fail the API call if database save fails
    }

    return NextResponse.json(
      {
        success: true,
        messageId: result.messageId,
        phone: normalizedPhone,
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
      errors: [] as Array<{ phone: string; error: string }>,
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
            error: sendResult.error || 'Failed to send message',
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
