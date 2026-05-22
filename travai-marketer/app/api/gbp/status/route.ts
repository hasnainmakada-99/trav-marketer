import { NextRequest, NextResponse } from 'next/server';
import { getBusinessConfigByTeamId } from '@/lib/gbp';
import { updateDocument } from '@/lib/appwrite';

/**
 * GET /api/gbp/status?teamId=...
 * Lightweight check — only reads DB, no Google API call.
 * Returns { connected, hasLocation, businessName, googleLocationId }
 */
export async function GET(request: NextRequest) {
  try {
    const teamId = new URL(request.url).searchParams.get('teamId');
    if (!teamId) return NextResponse.json({ connected: false }, { status: 400 });

    const config = await getBusinessConfigByTeamId(teamId);
    const token = typeof config?.googleAccessToken === 'string' && config.googleAccessToken.length > 10
      ? config.googleAccessToken
      : null;

    return NextResponse.json(
      {
        connected: !!token,
        hasLocation: !!config?.googleLocationId,
        googleLocationId: config?.googleLocationId || null,
        businessName: config?.businessName || null,
      },
      { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=30' } }
    );
  } catch {
    return NextResponse.json({ connected: false }, { status: 200 });
  }
}

/**
 * PATCH /api/gbp/status
 * Save selected Google location to business_configs.
 * Body: { teamId, googleLocationId, googleLocationTitle }
 */
export async function PATCH(request: NextRequest) {
  try {
    const { teamId, googleLocationId } = await request.json();
    if (!teamId || !googleLocationId) {
      return NextResponse.json({ error: 'Missing teamId or googleLocationId' }, { status: 400 });
    }

    const config = await getBusinessConfigByTeamId(teamId);
    if (!config) return NextResponse.json({ error: 'No config found' }, { status: 404 });

    await updateDocument('business_configs', config.$id, {
      googleLocationId,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, googleLocationId });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
