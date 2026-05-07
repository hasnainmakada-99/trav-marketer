import { NextRequest, NextResponse } from 'next/server';
import {
  decodeState,
  exchangeCodeForTokens,
  listGoogleAccounts,
  listGoogleLocations,
  saveGoogleConnection,
  toV4LocationName,
} from '@/lib/gbp';

/**
 * GET /api/gbp/callback
 * Handles Google OAuth callback and stores tokens against the team.
 */
export async function GET(request: NextRequest) {
  let origin = '';
  let fallbackPath = '/dashboard/gbp';
  try {
    const { searchParams, origin: reqOrigin } = new URL(request.url);
    origin = reqOrigin;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const oauthError = searchParams.get('error');
    const oauthErrorDescription = searchParams.get('error_description');

    const parsedState = state ? decodeState(state) : null;
    fallbackPath = parsedState?.redirectTo || '/dashboard/gbp';

    if (oauthError) {
      const reasonText = oauthErrorDescription
        ? `${oauthError}: ${oauthErrorDescription}`
        : oauthError;
      return NextResponse.redirect(
        `${origin}${fallbackPath}?connected=false&reason=${encodeURIComponent(reasonText)}`
      );
    }

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing OAuth callback parameters' }, { status: 400 });
    }

    if (!parsedState?.teamId) {
      return NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 });
    }

    const tokens = await exchangeCodeForTokens(code, parsedState.redirectUri);
    let selectedV4LocationName: string | undefined;

    // Best effort: don't fail OAuth if location discovery has API/permission issues.
    try {
      const accounts = await listGoogleAccounts(tokens.access_token);
      if (accounts.length > 0 && accounts[0].name) {
        const locations = await listGoogleLocations(tokens.access_token, accounts[0].name);
        if (locations.length > 0 && locations[0].name) {
          selectedV4LocationName = toV4LocationName(accounts[0].name, locations[0].name);
        }
      }
    } catch (locationDiscoveryError) {
      console.warn(
        '[GBP Callback] Token saved, but location discovery failed:',
        locationDiscoveryError
      );
    }

    await saveGoogleConnection(parsedState.teamId, {
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token,
      googleLocationId: selectedV4LocationName,
    });

    const finalPath = parsedState.redirectTo || fallbackPath;
    return NextResponse.redirect(`${origin}${finalPath}?connected=true`);
  } catch (error) {
    console.error('[GBP Callback] Error:', error);
    const reason = encodeURIComponent(error instanceof Error ? error.message : 'Unknown error');
    if (origin) {
      return NextResponse.redirect(`${origin}${fallbackPath}?connected=false&reason=${reason}`);
    }
    return NextResponse.json(
      { error: 'Failed to complete Google OAuth setup', reason },
      { status: 500 }
    );
  }
}
