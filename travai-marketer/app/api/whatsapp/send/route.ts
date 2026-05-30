import { NextRequest, NextResponse } from 'next/server';
import { sendYCloudTextMessage } from '@/lib/whatsapp-ycloud';
import { createDocument, getDocument, updateDocument } from '@/lib/appwrite';

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

function buildLocalTemplateMessage(body: string, buttons: string[]): string {
  if (!buttons.length) {
    return body;
  }
  const options = buttons.map((label, idx) => `${idx + 1}. ${label}`).join('\n');
  return `${body}\n\n${options}`.trim();
}

async function sendTextViaYCloud(phone: string, message: string) {
  const apiKey = (process.env.YCLOUD_API_KEY || '').trim();
  const fromPhone = (process.env.YCLOUD_WHATSAPP_FROM || '').trim();

  if (!apiKey || !fromPhone) {
    throw new Error('YCloud is not configured. Set YCLOUD_API_KEY and YCLOUD_WHATSAPP_FROM.');
  }

  const ycloudResult = await sendYCloudTextMessage({
    apiKey,
    fromPhoneE164: fromPhone,
    toPhone: phone,
    message,
  });

  if (!ycloudResult.success) {
    throw new Error(ycloudResult.error || 'Failed to send message via YCloud');
  }

  return ycloudResult;
}

/**
 * POST /api/whatsapp/send
 * Send a WhatsApp message to a customer via YCloud
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

    const teamId = body.teamId || 'system';
    const normalizedPhone = String(phone || '').replace(/[^\d]/g, '');

    if (!normalizedPhone) {
      return NextResponse.json(
        { error: 'Missing required field: phone' },
        { status: 400 }
      );
    }

    if (templateName) {
      return NextResponse.json(
        { error: 'Meta template sends are disabled. This project now uses YCloud-only text sends.' },
        { status: 400 }
      );
    }

    const normalizedParams = Array.isArray(templateParams)
      ? templateParams.map((p: unknown) => String(p || '').trim()).filter(Boolean)
      : [];

    let outboundMessage = String(message || '').trim();
    let messageType: 'text' | 'template' = 'text';

    if (localTemplateId) {
      const localTemplate = (await getDocument(
        'wa_local_templates',
        String(localTemplateId)
      )) as {
        teamId?: string;
        body?: string;
        buttons?: string | null;
      };

      if (!localTemplate?.body) {
        return NextResponse.json({ error: 'Local template not found' }, { status: 404 });
      }
      if (localTemplate.teamId && localTemplate.teamId !== teamId) {
        return NextResponse.json({ error: 'Local template team mismatch' }, { status: 403 });
      }

      const renderedBody = applyTemplateParams(String(localTemplate.body || ''), normalizedParams).trim();
      const renderedButtons = parseButtons(localTemplate.buttons || null)
        .map((btn) => applyTemplateParams(btn, normalizedParams).trim())
        .filter(Boolean)
        .slice(0, 3);

      if (!renderedBody) {
        return NextResponse.json(
          { error: 'Rendered local template body is empty' },
          { status: 400 }
        );
      }

      outboundMessage = buildLocalTemplateMessage(renderedBody, renderedButtons);
      messageType = 'template';
    }

    if (!outboundMessage) {
      return NextResponse.json(
        { error: 'Missing required fields: message or localTemplateId' },
        { status: 400 }
      );
    }

    const ycloudResult = await sendTextViaYCloud(normalizedPhone, outboundMessage);

    try {
      await createDocument('conversations', {
        teamId,
        customerId: customerId || 'manual',
        phone: normalizedPhone,
        role: 'assistant',
        message: outboundMessage,
        messageType,
        sentBy: 'staff',
        metaMessageId: ycloudResult.messageId || null,
        deliveryStatus: 'sent',
        createdAt: new Date().toISOString(),
      });
    } catch (dbError) {
      console.error('Failed to save YCloud message to database:', dbError);
    }

    return NextResponse.json(
      {
        success: true,
        mode: 'ycloud',
        messageId: ycloudResult.messageId || null,
        phone: normalizedPhone,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[WhatsApp Send] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send message' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/whatsapp/send
 * Send messages to multiple customers (for campaigns) via YCloud
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      campaignId,
      recipients,
      message,
      templateName,
      teamId,
    } = body;

    if (templateName) {
      return NextResponse.json(
        { error: 'Template campaigns are disabled in YCloud-only mode. Use text message campaigns.' },
        { status: 400 }
      );
    }

    if (!recipients || !Array.isArray(recipients) || !String(message || '').trim()) {
      return NextResponse.json(
        { error: 'Invalid request format' },
        { status: 400 }
      );
    }

    const normalizedMessage = String(message).trim();
    const results = {
      sent: 0,
      failed: 0,
      errors: [] as Array<{ phone: string; error: string }>,
    };

    for (const recipient of recipients) {
      const rawPhone = String(recipient?.phone || '');
      const normalizedPhone = rawPhone.replace(/[^\d]/g, '');
      if (!normalizedPhone) {
        results.failed++;
        results.errors.push({ phone: rawPhone, error: 'Invalid recipient phone' });
        continue;
      }

      try {
        const sendResult = await sendTextViaYCloud(normalizedPhone, normalizedMessage);
        results.sent++;

        if (campaignId) {
          await createDocument('campaign_logs', {
            teamId: teamId || 'system',
            campaignId,
            phone: normalizedPhone,
            customerId: recipient.customerId || '',
            status: 'sent',
            metaMessageId: sendResult.messageId || null,
            sentAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          phone: normalizedPhone,
          error: error instanceof Error ? error.message : String(error),
        });

        if (campaignId) {
          try {
            await createDocument('campaign_logs', {
              teamId: teamId || 'system',
              campaignId,
              phone: normalizedPhone,
              customerId: recipient.customerId || '',
              status: 'failed',
              metaMessageId: null,
              sentAt: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
            });
          } catch (logError) {
            console.error('Failed to save failed campaign log:', logError);
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (campaignId) {
      try {
        await updateDocument('campaigns', campaignId, {
          status: results.failed === 0 ? 'sent' : 'partial',
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
        mode: 'ycloud',
        ...results,
        total: recipients.length,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[WhatsApp Bulk Send] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send bulk messages' },
      { status: 500 }
    );
  }
}
