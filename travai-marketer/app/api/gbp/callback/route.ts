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
 * Handles Google OAuth callback, stores tokens, and caches location data.
 *
 * Location caching strategy:
 *   - Fetch all accounts + locations right after token exchange (token is
 *     freshly minted so quota is clean for this user).
 *   - Store serialised as googleLocationsJson in business_configs.
 *   - If only 1 location found, auto-select it (sets googleLocationId).
 *   - All future /api/gbp/locations calls read from this cache — Google
 *     API is never called again for location listing unless user clicks
 *     "Refresh from Google".
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

    // ── Fetch and cache ALL accounts + locations ──────────────────────────
    // The token is freshly issued, so quota is clean. We cache everything
    // so /api/gbp/locations never needs to call Google again.
    type CachedLocation = { resourceName: string; v4LocationName: string; title?: string };
    type CachedAccount = { accountName: string; accountDisplayName?: string; locations: CachedLocation[] };

    let cachedAccounts: CachedAccount[] = [];
    let autoSelectedLocationId: string | undefined;

    try {
      const accounts = await listGoogleAccounts(tokens.access_token);
      for (const account of accounts) {
        if (!account.name) continue;
        const locations = await listGoogleLocations(tokens.access_token, account.name);
        const mappedLocations: CachedLocation[] = locations
          .filter(l => typeof l.name === 'string')
          .map(l => ({
            resourceName: l.name,
            v4LocationName: toV4LocationName(account.name, l.name),
            title: l.title,
          }));
        cachedAccounts.push({
          accountName: account.name,
          accountDisplayName: account.accountName,
          locations: mappedLocations,
        });
      }

      // Auto-select when there is exactly one location across all accounts.
      const allLocations = cachedAccounts.flatMap(a => a.locations);
      if (allLocations.length === 1) {
        autoSelectedLocationId = allLocations[0].v4LocationName;
      }
    } catch (locationErr) {
      console.warn('[GBP Callback] Location discovery failed (quota?):', locationErr);
      // Continue — tokens are still saved; user can refresh later.
    }

    const locationsJson =
      cachedAccounts.length > 0 ? JSON.stringify(cachedAccounts) : undefined;

    await saveGoogleConnection(parsedState.teamId, {
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token,
      googleLocationId: autoSelectedLocationId,
      googleLocationsJson: locationsJson,
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
