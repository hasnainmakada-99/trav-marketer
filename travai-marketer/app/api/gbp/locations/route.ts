import { NextRequest, NextResponse } from 'next/server';
import {
  getAccessTokenForTeam,
  listGoogleAccounts,
  listGoogleLocations,
  toV4LocationName,
} from '@/lib/gbp';

type LocationRow = { resourceName: string; v4LocationName: string; title?: string };
type AccountRow = { accountName: string; accountDisplayName?: string; locations: LocationRow[] };

async function fetchAccounts(teamId: string, forceRefresh = false): Promise<AccountRow[]> {
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
 * GET /api/gbp/locations?teamId=...
 * Lists Google Business Profile accounts and locations for the connected team.
 * On 401 (expired token) automatically refreshes and retries once.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get('teamId');

  if (!teamId) {
    return NextResponse.json({ error: 'Missing teamId parameter' }, { status: 400 });
  }

  try {
    let result: AccountRow[];
    try {
      result = await fetchAccounts(teamId, false);
    } catch (firstErr) {
      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      // On 401/auth errors, force-refresh the token and retry once.
      const isAuth = msg.includes('401') || /unauthorized|unauthenticated|invalid.credentials/i.test(msg);
      if (isAuth) {
        result = await fetchAccounts(teamId, true);
      } else {
        throw firstErr;
      }
    }
    return NextResponse.json({ teamId, accounts: result }, { status: 200 });
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
