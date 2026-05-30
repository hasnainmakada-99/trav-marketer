import { NextResponse } from 'next/server';

/**
 * GET /api/whatsapp/templates
 * Template sync has been retired in YCloud-only mode.
 */
export async function GET() {
  const ycloudReady =
    Boolean((process.env.YCLOUD_API_KEY || '').trim()) &&
    Boolean((process.env.YCLOUD_WHATSAPP_FROM || '').trim());

  return NextResponse.json(
    {
      templates: [],
      integrationStatus: ycloudReady ? 'connected' : 'disconnected',
      notice:
        'Template sync is disabled because this project now runs in YCloud-only mode. Use text or local template messages via /api/whatsapp/send.',
      error: ycloudReady
        ? null
        : 'YCloud send is not configured. Set YCLOUD_API_KEY and YCLOUD_WHATSAPP_FROM.',
    },
    { status: 200 }
  );
}
