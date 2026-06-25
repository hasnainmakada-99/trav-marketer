import { createHmac, timingSafeEqual } from 'crypto';
import PocketBase from 'pocketbase';
import { cookies } from 'next/headers';

export type DashboardUser = {
  $id: string;
  email: string;
  name: string;
};

const AUTH_COOKIE_NAME = 'travai_dashboard_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function getPocketBaseUrl() {
  return (process.env.POCKETBASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
}

function getPocketBasePublicUrl() {
  return (
    process.env.POCKETBASE_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.POCKETBASE_URL ||
    'http://127.0.0.1:8090'
  ).replace(/\/+$/, '');
}

function getAuthSecret() {
  return (
    process.env.TRAVAI_AUTH_SECRET ||
    process.env.PB_VIEWER_SECRET ||
    process.env.POCKETBASE_SUPERUSER_PASSWORD ||
    'trav-ai-dashboard-auth'
  );
}

function getConfiguredSuperuserEmail() {
  return String(process.env.POCKETBASE_SUPERUSER_EMAIL || '').trim().toLowerCase();
}

function getConfiguredSuperuserPassword() {
  return String(process.env.POCKETBASE_SUPERUSER_PASSWORD || '');
}

function safeEquals(left: string, right: string) {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function toBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(encodedPayload: string) {
  return createHmac('sha256', getAuthSecret())
    .update(encodedPayload, 'utf8')
    .digest('hex');
}

function buildDisplayName(email: string) {
  const localPart = email.split('@')[0] || 'TravAI Admin';
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ') || 'TravAI Admin';
}

function buildDashboardUser(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  return {
    $id: `pb-superuser:${normalizedEmail}`,
    email: normalizedEmail,
    name: buildDisplayName(normalizedEmail),
  } satisfies DashboardUser;
}

function buildSessionCookieValue(user: DashboardUser) {
  const payload = {
    ...user,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

function parseSessionCookieValue(value: string): DashboardUser | null {
  const [encodedPayload, signature] = String(value || '').split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  if (!safeEquals(signature, expectedSignature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(encodedPayload)) as DashboardUser & {
      expiresAt?: number;
    };
    if (!parsed?.email || !parsed?.$id || !parsed?.name) {
      return null;
    }
    if (!parsed.expiresAt || parsed.expiresAt < Date.now()) {
      return null;
    }
    return {
      $id: parsed.$id,
      email: parsed.email,
      name: parsed.name,
    };
  } catch {
    return null;
  }
}

async function authenticateAgainstPocketBase(email: string, password: string) {
  const pb = new PocketBase(getPocketBaseUrl());
  pb.autoCancellation(false);
  await pb.collection('_superusers').authWithPassword(email, password);

  const record = pb.authStore.record as { email?: string } | null;
  return buildDashboardUser(record?.email || email);
}

export async function authenticateDashboardUser(email: string, password: string) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = String(password || '');

  if (!normalizedEmail || !normalizedPassword) {
    return null;
  }

  const configuredEmail = getConfiguredSuperuserEmail();
  const configuredPassword = getConfiguredSuperuserPassword();

  if (
    configuredEmail &&
    configuredPassword &&
    safeEquals(normalizedEmail, configuredEmail) &&
    safeEquals(normalizedPassword, configuredPassword)
  ) {
    return buildDashboardUser(normalizedEmail);
  }

  try {
    return await authenticateAgainstPocketBase(normalizedEmail, normalizedPassword);
  } catch {
    return null;
  }
}

export async function getDashboardSessionUser() {
  const store = await cookies();
  const cookieValue = store.get(AUTH_COOKIE_NAME)?.value || '';
  return parseSessionCookieValue(cookieValue);
}

export async function createDashboardSession(user: DashboardUser) {
  const store = await cookies();
  store.set(AUTH_COOKIE_NAME, buildSessionCookieValue(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearDashboardSession() {
  const store = await cookies();
  store.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export function getPocketBaseAdminUrl() {
  return `${getPocketBasePublicUrl()}/_/`;
}
