import { NextRequest, NextResponse } from 'next/server';
import { buildGoogleConsentUrl } from '@/lib/gbp';

/**
 * GET /api/gbp/connect?teamId=...&redirectTo=...
 * Starts Google OAuth flow for Business Profile APIs.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId');
    const redirectTo = searchParams.get('redirectTo') || '/dashboard/gbp';

    if (!teamId) {
      return NextResponse.json(
        { error: 'Missing required query parameter: teamId' },
        { status: 400 }
      );
    }

    const consentUrl = buildGoogleConsentUrl(teamId, redirectTo);
    return NextResponse.redirect(consentUrl);
  } catch (error) {
    console.error('[GBP Connect] Error:', error);
    return NextResponse.json({ error: 'Failed to start Google OAuth flow' }, { status: 500 });
  }
}
