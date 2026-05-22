import { NextRequest, NextResponse } from 'next/server';
import {
  getAccessTokenForTeam,
  getBusinessConfigByTeamId,
  listGoogleAccounts,
  listGoogleLocations,
  saveGoogleConnection,
  toV4LocationName,
} from '@/lib/gbp';

type LocationRow = { resourceName: string; v4LocationName: string; title?: string };
type AccountRow = { accountName: string; accountDisplayName?: string; locations: LocationRow[] };

async function fetchFromGoogle(teamId: string, forceRefresh = false): Promise<AccountRow[]> {
  const accessToken = await getAccessTokenForTeam(teamId, { forceRefresh });
  const accounts = await listGoogleAccounts(accessToken);

  const result: AccountRow[] = [];
  for (const account of accounts) {
    if (!account.name) continue;
    const locations = await listGoogleLocations(accessToken, account.name);
    result.push({
      accountName: account.name,
      accountDisplayName: account.accountName,
      locations: locations
        .filter(l => typeof l.name === 'string')
        .map(l => ({
          resourceName: l.name,
          v4LocationName: toV4LocationName(account.name, l.name),
          title: l.title,
        })),
    });
  }
  return result;
}

/**
 * GET /api/gbp/locations?teamId=...&refresh=true
 *
 * Caching strategy:
 *   1. Read googleLocationsJson from business_configs (DB, no Google API).
 *   2. If cached data exists AND ?refresh is not set, return it immediately.
 *   3. Only call Google API when cache is empty or ?refresh=true.
 *   4. On success, write back to cache so next call is instant.
 *   5. On 401, auto-refresh the token and retry once before giving up.
 *
 * This means Google's Account Management API (300 QPM) is called at most
 * once per OAuth connection + once each time the user explicitly refreshes.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get('teamId');
  const forceRefresh = searchParams.get('refresh') === 'true';

  if (!teamId) {
    return NextResponse.json({ error: 'Missing teamId parameter' }, { status: 400 });
  }

  try {
    // ── 1. Try cache ───────────────────────────────────────────────────
    if (!forceRefresh) {
      const config = await getBusinessConfigByTeamId(teamId);
      if (config?.googleLocationsJson) {
        try {
          const cached = JSON.parse(config.googleLocationsJson) as AccountRow[];
          if (Array.isArray(cached) && cached.length > 0) {
            return NextResponse.json(
              { teamId, accounts: cached, fromCache: true },
              { status: 200, headers: { 'Cache-Control': 'private, max-age=3600, stale-while-revalidate=300' } }
            );
          }
        } catch {
          // Corrupt cache — fall through to Google
        }
      }
    }

    // ── 2. Call Google API ─────────────────────────────────────────────
    let result: AccountRow[];
    try {
      result = await fetchFromGoogle(teamId, false);
    } catch (firstErr) {
      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      const isAuth = msg.includes('401') || /unauthorized|unauthenticated|invalid.credentials/i.test(msg);
      if (isAuth) {
        // Token expired — force-refresh and retry once.
        result = await fetchFromGoogle(teamId, true);
      } else {
        throw firstErr;
      }
    }

    // ── 3. Write to cache ──────────────────────────────────────────────
    if (result.length > 0) {
      const json = JSON.stringify(result);
      // Truncate if too large for the 4000-char field (very unlikely).
      const safeJson = json.length <= 3900 ? json : undefined;
      if (safeJson) {
        // Fire-and-forget — don't block the response.
        const config = await getBusinessConfigByTeamId(teamId);
        if (config) {
          saveGoogleConnection(teamId, {
            googleAccessToken: config.googleAccessToken || '',
            googleLocationsJson: safeJson,
          }).catch(() => {});
        }
      }
    }

    return NextResponse.json({ teamId, accounts: result, fromCache: false }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (
      message.includes('No business configuration found') ||
      message.includes('Google access is not connected')
    ) {
      return NextResponse.json({ accounts: [], connected: false, reason: message }, { status: 200 });
    }

    const isQuota = /quota|rate.limit|QPM|QPD/i.test(message);
    console.error('[GBP Locations] Error:', error);
    return NextResponse.json(
      {
        accounts: [],
        error: isQuota ? 'quota_exceeded' : 'fetch_failed',
        reason: message,
      },
      { status: 200 }
    );
  }
}
