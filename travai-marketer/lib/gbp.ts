import { Query } from 'node-appwrite';
import { listDocuments, updateDocument, createDocument } from '@/lib/appwrite';

const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage';

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

interface GbpOAuthState {
  teamId: string;
  redirectTo?: string;
  redirectUri?: string;
}

interface BusinessConfigDocument {
  $id: string;
  teamId: string;
  businessName?: string;
  googleAccessToken?: string;
  googleRefreshToken?: string;
  googleLocationId?: string;
  googleLocationsJson?: string;
}

export interface GbpAccount {
  name: string;
  accountName?: string;
  type?: string;
}

export interface GbpLocation {
  name: string;
  title?: string;
  storefrontAddress?: {
    locality?: string;
    administrativeArea?: string;
    postalCode?: string;
  };
}

interface GoogleReviewListResponse {
  reviews?: Array<{
    name: string;
    reviewId: string;
    reviewer?: { displayName?: string };
    starRating?: string;
    comment?: string;
    reviewReply?: { comment?: string };
    createTime?: string;
    updateTime?: string;
  }>;
}

interface GoogleLocalPostListResponse {
  localPosts?: GoogleLocalPost[];
}

export interface GoogleLocalPostMedia {
  mediaFormat: 'PHOTO' | 'VIDEO';
  sourceUrl: string;
}

export interface GoogleLocalPost {
  name?: string;
  languageCode?: string;
  summary?: string;
  createTime?: string;
  updateTime?: string;
  state?: string;
  searchUrl?: string;
  topicType?: string;
  media?: Array<{
    mediaFormat?: 'PHOTO' | 'VIDEO';
    sourceUrl?: string;
    googleUrl?: string;
    thumbnailUrl?: string;
  }>;
  callToAction?: {
    actionType?: string;
    url?: string;
    phoneNumber?: string;
  };
}

function getOAuthConfig(options?: {
  requireClientSecret?: boolean;
  redirectUriOverride?: string;
}) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const redirectUri =
    options?.redirectUriOverride ||
    process.env.GOOGLE_REDIRECT_URI ||
    `${appUrl.replace(/\/+$/, '')}/api/gbp/callback`;

  const missing: string[] = [];
  if (!clientId) {
    missing.push('GOOGLE_CLIENT_ID');
  }
  if (options?.requireClientSecret && !clientSecret) {
    missing.push('GOOGLE_CLIENT_SECRET');
  }
  if (!redirectUri) {
    missing.push('GOOGLE_REDIRECT_URI');
  }

  if (missing.length > 0) {
    throw new Error(`Google OAuth is not fully configured. Missing: ${missing.join(', ')}`);
  }

  return { clientId: clientId || '', clientSecret: clientSecret || '', redirectUri };
}

function parseJsonSafe<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function encodeState(state: GbpOAuthState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

export function decodeState(encodedState: string): GbpOAuthState | null {
  try {
    const decoded = Buffer.from(encodedState, 'base64url').toString('utf8');
    const parsed = parseJsonSafe<GbpOAuthState>(decoded);
    if (!parsed?.teamId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildGoogleConsentUrl(
  teamId: string,
  redirectTo?: string,
  redirectUriOverride?: string
): string {
  const { clientId, redirectUri } = getOAuthConfig({ redirectUriOverride });
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);

  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_BUSINESS_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', encodeState({ teamId, redirectTo, redirectUri }));

  return url.toString();
}

async function exchangeToken(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
  });

  const payload = await response.text();
  const parsed = parseJsonSafe<GoogleTokenResponse & { error?: string }>(payload);

  if (!response.ok || !parsed?.access_token) {
    const errorMessage = parsed?.error || payload || 'Failed to exchange Google OAuth token';
    throw new Error(errorMessage);
  }

  return parsed;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUriOverride?: string
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig({
    requireClientSecret: true,
    redirectUriOverride,
  });
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  return exchangeToken(body);
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getOAuthConfig({
    requireClientSecret: true,
  });
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  return exchangeToken(body);
}

export async function getBusinessConfigByTeamId(
  teamId: string
): Promise<BusinessConfigDocument | null> {
  const response = await listDocuments('business_configs', [
    Query.equal('teamId', teamId),
    Query.limit(1),
  ]);

  if (!response.documents.length) {
    return null;
  }

  return response.documents[0] as unknown as BusinessConfigDocument;
}

export async function saveGoogleConnection(
  teamId: string,
  updates: {
    googleAccessToken: string;
    googleRefreshToken?: string;
    googleLocationId?: string;
    googleLocationsJson?: string;
  }
): Promise<void> {
  const businessConfig = await getBusinessConfigByTeamId(teamId);

  if (businessConfig) {
    // Update existing config
    const patch: Record<string, unknown> = {
      googleAccessToken: updates.googleAccessToken,
      googleRefreshToken: updates.googleRefreshToken || businessConfig.googleRefreshToken || null,
      googleLocationId: updates.googleLocationId || businessConfig.googleLocationId || null,
      updatedAt: new Date().toISOString(),
    };
    if (updates.googleLocationsJson !== undefined) {
      patch.googleLocationsJson = updates.googleLocationsJson;
    }
    await updateDocument('business_configs', businessConfig.$id, patch);
  } else {
    // No config exists yet — create one automatically so the client
    // can connect GBP without any prior manual DB setup.
    const now = new Date().toISOString();
    const fullPayload: Record<string, unknown> = {
      teamId,
      businessName: 'My Business',
      googleAccessToken: updates.googleAccessToken,
      googleRefreshToken: updates.googleRefreshToken || null,
      googleLocationId: updates.googleLocationId || null,
      whatsappToken: '__PENDING_WHATSAPP_TOKEN__',
      whatsappPhoneNumberId: '__PENDING_PHONE_NUMBER_ID__',
      whatsappVerifyToken:
        process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '__PENDING_WHATSAPP_VERIFY_TOKEN__',
      createdAt: now,
      updatedAt: now,
    };

    await createDocument('business_configs', fullPayload);
  }
}

export async function getAccessTokenForTeam(
  teamId: string,
  { forceRefresh = false }: { forceRefresh?: boolean } = {}
): Promise<string> {
  const businessConfig = await getBusinessConfigByTeamId(teamId);
  if (!businessConfig) {
    throw new Error(`No business configuration found for teamId "${teamId}"`);
  }

  const accessToken = businessConfig.googleAccessToken;
  const refreshToken = businessConfig.googleRefreshToken;

  // forceRefresh is set after a 401 to get a new token without an extra DB hit.
  if (!forceRefresh && typeof accessToken === 'string' && accessToken.length > 0) {
    return accessToken;
  }

  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    throw new Error('Google access is not connected for this team');
  }

  const refreshed = await refreshAccessToken(refreshToken);
  await saveGoogleConnection(teamId, {
    googleAccessToken: refreshed.access_token,
    googleRefreshToken: refreshed.refresh_token || refreshToken,
  });

  return refreshed.access_token;
}

async function googleFetch<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });

  const bodyText = await response.text();
  const parsed = parseJsonSafe<T & { error?: { message?: string } }>(bodyText);

  if (!response.ok || !parsed) {
    const message =
      parsed?.error?.message || bodyText || `Google API request failed (${response.status})`;
    throw new Error(message);
  }

  return parsed as T;
}

export async function listGoogleAccounts(accessToken: string): Promise<GbpAccount[]> {
  const response = await googleFetch<{ accounts?: GbpAccount[] }>(
    'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    accessToken
  );

  return response.accounts || [];
}

export async function listGoogleLocations(
  accessToken: string,
  accountName: string
): Promise<GbpLocation[]> {
  const url = new URL(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`
  );
  url.searchParams.set('readMask', 'name,title,storeCode,storefrontAddress');
  url.searchParams.set('pageSize', '100');

  const response = await googleFetch<{ locations?: GbpLocation[] }>(url.toString(), accessToken);
  return response.locations || [];
}

export interface GbpCallToAction {
  actionType: 'BOOK' | 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'SIGN_UP' | 'CALL';
  url?: string;
  phoneNumber?: string;
}

export async function createGoogleLocalPost(
  accessToken: string,
  locationName: string,
  summary: string,
  languageCode = 'en',
  callToAction?: GbpCallToAction,
  media?: GoogleLocalPostMedia[]
): Promise<GoogleLocalPost> {
  const payload: Record<string, unknown> = {
    languageCode,
    summary,
    topicType: 'STANDARD',
  };
  if (callToAction) {
    payload.callToAction = callToAction;
  }
  if (media && media.length > 0) {
    payload.media = media;
  }
  return googleFetch<GoogleLocalPost>(
    `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
    accessToken,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

export async function listGoogleLocalPosts(
  accessToken: string,
  locationName: string
): Promise<GoogleLocalPost[]> {
  const url = new URL(`https://mybusiness.googleapis.com/v4/${locationName}/localPosts`);
  url.searchParams.set('pageSize', '50');

  const response = await googleFetch<GoogleLocalPostListResponse>(url.toString(), accessToken);
  return response.localPosts || [];
}

export async function listGoogleReviews(
  accessToken: string,
  locationName: string
): Promise<GoogleReviewListResponse['reviews']> {
  const url = new URL(`https://mybusiness.googleapis.com/v4/${locationName}/reviews`);
  url.searchParams.set('pageSize', '50');
  url.searchParams.set('orderBy', 'updateTime desc');

  const response = await googleFetch<GoogleReviewListResponse>(url.toString(), accessToken);
  return response.reviews || [];
}

export async function deleteGoogleLocalPost(
  accessToken: string,
  postName: string
): Promise<void> {
  await googleFetch<Record<string, never>>(
    `https://mybusiness.googleapis.com/v4/${postName}`,
    accessToken,
    { method: 'DELETE' }
  );
}

export async function updateGoogleReviewReply(
  accessToken: string,
  reviewName: string,
  comment: string
): Promise<{ comment?: string }> {
  return googleFetch<{ comment?: string }>(
    `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({ comment }),
    }
  );
}

export function toV4LocationName(accountName: string, locationResourceName: string): string {
  const locationId = locationResourceName.split('/')[1];
  if (!locationId) {
    throw new Error('Invalid Google location resource name');
  }
  return `${accountName}/locations/${locationId}`;
}
