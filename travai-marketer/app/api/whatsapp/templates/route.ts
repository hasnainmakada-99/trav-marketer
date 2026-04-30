import { NextRequest, NextResponse } from 'next/server';
import { listWhatsAppTemplates } from '@/lib/whatsapp';

/**
 * GET /api/whatsapp/templates
 * List approved templates for the configured WABA.
 */
export async function GET(_request: NextRequest) {
  try {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const token = process.env.WHATSAPP_TOKEN;

    if (!wabaId || !token) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Missing WHATSAPP_BUSINESS_ACCOUNT_ID or WHATSAPP_TOKEN.',
          templates: [],
        },
        { status: 200 }
      );
    }

    const templates = await listWhatsAppTemplates({
      whatsappBusinessAccountId: wabaId,
      whatsappToken: token,
    });

    return NextResponse.json({ templates });
  } catch (error) {
    console.error('[WA templates] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed',
        templates: [],
      },
      { status: 500 }
    );
  }
}
