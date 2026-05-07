import { NextRequest, NextResponse } from 'next/server';
import {
  getAccessTokenForTeam,
  listGoogleAccounts,
  listGoogleLocations,
  toV4LocationName,
} from '@/lib/gbp';

/**
 * GET /api/gbp/locations?teamId=...
 * Lists Google Business Profile accounts and locations for the connected team.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId');

    if (!teamId) {
      return NextResponse.json({ error: 'Missing teamId parameter' }, { status: 400 });
    }

    const accessToken = await getAccessTokenForTeam(teamId);
    const accounts = await listGoogleAccounts(accessToken);

    const result: Array<{
      accountName: string;
      accountDisplayName?: string;
      locations: Array<{
        resourceName: string;
        v4LocationName: string;
        title?: string;
      }>;
    }> = [];

    for (const account of accounts) {
      if (!account.name) {
        continue;
      }

      const locations = await listGoogleLocations(accessToken, account.name);
      result.push({
        accountName: account.name,
        accountDisplayName: account.accountName,
        locations: locations
          .filter((location) => typeof location.name === 'string')
          .map((location) => ({
            resourceName: location.name,
            v4LocationName: toV4LocationName(account.name, location.name),
            title: location.title,
          })),
      });
    }

    return NextResponse.json({ teamId, accounts: result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Not-connected state should not be treated as a hard server error by the UI.
    if (
      message.includes('No business configuration found') ||
      message.includes('Google access is not connected')
    ) {
      return NextResponse.json(
        { teamId: null, accounts: [], connected: false, reason: message },
        { status: 200 }
      );
    }

    console.error('[GBP Locations] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch GBP locations', reason: message },
      { status: 500 }
    );
  }
}
