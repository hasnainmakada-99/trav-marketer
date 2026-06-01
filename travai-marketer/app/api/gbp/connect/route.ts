import { NextRequest, NextResponse } from 'next/server';
import { buildGoogleConsentUrl } from '@/lib/gbp';

/**
 * GET /api/gbp/connect?teamId=...&redirectTo=...
 * Starts Google OAuth flow for Business Profile APIs.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams, origin } = new URL(request.url);
    const teamId = searchParams.get('teamId') || process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID;
    const redirectToRaw = searchParams.get('redirectTo') || '/dashboard/gbp';
    const redirectTo = redirectToRaw.startsWith('/') ? redirectToRaw : '/dashboard/gbp';

    if (!teamId) {
      return NextResponse.json(
        {
          error:
            'Missing required query parameter: teamId. Pass ?teamId=... or set NEXT_PUBLIC_DEFAULT_TEAM_ID.',
        },
        { status: 400 }
      );
    }

    // Always use GOOGLE_REDIRECT_URI from env — never derive from request origin.
    // Dynamic derivation breaks behind reverse proxies (Nginx → localhost:3000).
    void origin;
    const consentUrl = buildGoogleConsentUrl(teamId, redirectTo);
    return NextResponse.redirect(consentUrl);
  } catch (error) {
    console.error('[GBP Connect] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to start Google OAuth flow',
        reason: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
