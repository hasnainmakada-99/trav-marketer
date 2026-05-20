/**
 * One-shot script: refreshes the GBP OAuth token, then uses googleLocations:search
 * to auto-detect the location ID.  When the connected Google account IS the admin
 * of the business, the search returns accounts/{accountId}/locations/{locationId}
 * instead of googleLocations/{placeId}.  If that succeeds, saves to Appwrite.
 *
 * Run: node scripts/populate-location-cache.mjs
 */
import { Client, Databases, Query } from 'node-appwrite';

// Load from environment — copy .env.local values or export before running:
//   export APPWRITE_ENDPOINT=https://sfo.cloud.appwrite.io/v1
//   export APPWRITE_PROJECT_ID=...
//   export APPWRITE_API_KEY=...
//   export GOOGLE_CLIENT_ID=...
//   export GOOGLE_CLIENT_SECRET=...
const ENDPOINT   = process.env.APPWRITE_ENDPOINT   || 'https://sfo.cloud.appwrite.io/v1';
const PROJECT_ID = process.env.APPWRITE_PROJECT_ID || '';
const API_KEY    = process.env.APPWRITE_API_KEY    || '';
const DB         = 'travai';
const COL        = 'business_configs';

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

if (!PROJECT_ID || !API_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Missing required env vars. See the comment at the top of this script.');
  process.exit(1);
}

const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(API_KEY);
const db = new Databases(client);

async function refreshToken(rt) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: rt,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('Refresh failed: ' + JSON.stringify(json));
  return json.access_token;
}

const list = await db.listDocuments(DB, COL, [Query.limit(20)]);
console.log(`Found ${list.total} business_configs\n`);

for (const doc of list.documents) {
  const teamId = doc.teamId || doc.$id;
  const businessName = doc.businessName || '';
  console.log(`── teamId: ${teamId}  businessName: "${businessName}" ──`);

  let accessToken = doc.googleAccessToken;
  const storedRefresh = doc.googleRefreshToken;

  if (!accessToken && !storedRefresh) {
    console.log('  No Google token — skipping\n');
    continue;
  }

  if (storedRefresh) {
    try {
      accessToken = await refreshToken(storedRefresh);
      console.log('  Token refreshed ✓');
      await db.updateDocument(DB, COL, doc.$id, {
        googleAccessToken: accessToken,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.log(`  Token refresh failed: ${e.message}`);
      if (!accessToken) { console.log('  No fallback — skipping\n'); continue; }
    }
  }

  // ── googleLocations:search ────────────────────────────────────────────────
  // When the token belongs to the admin of this location, Google returns the
  // full "accounts/{id}/locations/{id}" path instead of "googleLocations/{placeId}".
  console.log(`  Searching for "${businessName}"…`);
  let foundLocation = null;

  const searchRes = await fetch(
    'https://mybusinessbusinessinformation.googleapis.com/v1/googleLocations:search',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: businessName || 'Traventions India Pvt Ltd Bengaluru', pageSize: 5 }),
    }
  );
  const searchData = await searchRes.json();

  for (const loc of searchData.googleLocations || []) {
    console.log(`  result name: ${loc.name}  title: ${loc.location?.title || '—'}`);
    if (loc.name?.startsWith('accounts/')) {
      foundLocation = {
        v4LocationName: loc.name,
        accountPart: loc.name.split('/locations/')[0],
        title: loc.location?.title || businessName,
      };
      console.log(`  ✓ Admin location detected: ${loc.name}`);
      break;
    }
  }

  if (!foundLocation) {
    console.log(`  ✗ Connected account is NOT the admin of this location.`);
    console.log(`    The "requestAdminRightsUri" being returned means the connected Google`);
    console.log(`    account doesn't own/manage this GBP listing.`);
    console.log(`    → The business owner must reconnect with THEIR Google account.\n`);
    continue;
  }

  // Save to Appwrite
  const locationsJson = JSON.stringify([{
    accountName: foundLocation.accountPart,
    accountDisplayName: foundLocation.title,
    locations: [{
      resourceName: foundLocation.v4LocationName,
      v4LocationName: foundLocation.v4LocationName,
      title: foundLocation.title,
    }],
  }]);

  await db.updateDocument(DB, COL, doc.$id, {
    googleLocationId: foundLocation.v4LocationName,
    googleLocationsJson: locationsJson,
    updatedAt: new Date().toISOString(),
  });
  console.log('  ✓ Location saved to Appwrite!\n');
}

console.log('Done!');
