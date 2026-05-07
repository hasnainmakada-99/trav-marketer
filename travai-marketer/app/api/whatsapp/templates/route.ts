import { NextResponse } from 'next/server';
import { listWhatsAppTemplates } from '@/lib/whatsapp';

/**
 * GET /api/whatsapp/templates
 * List approved templates for the configured WABA.
 */
export async function GET() {
  try {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const token = process.env.WHATSAPP_TOKEN;
    const bridgeMode = Boolean(process.env.BRIDGE_SHARED_SECRET);

    if (!wabaId || !token) {
      return NextResponse.json(
        {
          error: bridgeMode
            ? null
            : 'WhatsApp not configured. Missing WHATSAPP_BUSINESS_ACCOUNT_ID or WHATSAPP_TOKEN.',
          notice: bridgeMode
            ? 'Template sync requires WhatsApp Cloud API credentials. WA Web bridge mode supports live chat without template sync.'
            : null,
          templates: [],
          integrationStatus: bridgeMode ? 'bridge_only' : 'disconnected',
        },
        { status: 200 }
      );
    }

    const templates = await listWhatsAppTemplates({
      whatsappBusinessAccountId: wabaId,
      whatsappToken: token,
    });

    return NextResponse.json({
      templates,
      integrationStatus: 'connected',
      notice: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    const normalized = message.toLowerCase();
    const bridgeMode = Boolean(process.env.BRIDGE_SHARED_SECRET);
    const recoverableMetaConfigError =
      normalized.includes('application has been deleted') ||
      normalized.includes('error validating application') ||
      normalized.includes('invalid oauth access token') ||
      normalized.includes('unsupported get request') ||
      normalized.includes('permissions error');

    if (recoverableMetaConfigError) {
      return NextResponse.json(
        {
          error: bridgeMode
            ? null
            : 'WhatsApp template sync is unavailable: Meta app/token is invalid or deleted. Reconnect WhatsApp in Meta settings.',
          notice: bridgeMode
            ? 'WA Web bridge is active. Meta templates are unavailable until Cloud API app/token is connected.'
            : null,
          templates: [],
          integrationStatus: bridgeMode ? 'bridge_only' : 'disconnected',
        },
        { status: 200 }
      );
    }

    console.error('[WA templates] Error:', error);
    return NextResponse.json(
      {
        error: message,
        templates: [],
      },
      { status: 500 }
    );
  }
}
