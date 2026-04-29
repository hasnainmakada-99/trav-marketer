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
  try {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const oauthError = searchParams.get('error');

    if (oauthError) {
      return NextResponse.redirect(
        `${origin}/dashboard/gbp?connected=false&reason=${encodeURIComponent(oauthError)}`
      );
    }

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing OAuth callback parameters' }, { status: 400 });
    }

    const parsedState = decodeState(state);
    if (!parsedState?.teamId) {
      return NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 });
    }

    const tokens = await exchangeCodeForTokens(code);
    const accounts = await listGoogleAccounts(tokens.access_token);

    let selectedV4LocationName: string | undefined;

    if (accounts.length > 0 && accounts[0].name) {
      const locations = await listGoogleLocations(tokens.access_token, accounts[0].name);
      if (locations.length > 0 && locations[0].name) {
        selectedV4LocationName = toV4LocationName(accounts[0].name, locations[0].name);
      }
    }

    await saveGoogleConnection(parsedState.teamId, {
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token,
      googleLocationId: selectedV4LocationName,
    });

    const finalPath = parsedState.redirectTo || '/dashboard/gbp';
    return NextResponse.redirect(`${origin}${finalPath}?connected=true`);
  } catch (error) {
    console.error('[GBP Callback] Error:', error);
    return NextResponse.json({ error: 'Failed to complete Google OAuth setup' }, { status: 500 });
  }
}
