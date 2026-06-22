import { createHash, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

const VIEWER_COOKIE_NAME = 'pb_viewer_session';

function getViewerUsername() {
  return process.env.PB_VIEWER_USERNAME || 'hasnain';
}

function getViewerPassword() {
  return process.env.PB_VIEWER_PASSWORD || 'hasnain123';
}

function getViewerSecret() {
  return process.env.PB_VIEWER_SECRET || 'trav-ai-pocketbase-viewer';
}

function buildSessionToken() {
  return createHash('sha256')
    .update(
      `${getViewerUsername()}:${getViewerPassword()}:${getViewerSecret()}`,
      'utf8'
    )
    .digest('hex');
}

function safeEquals(a: string, b: string) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function validateViewerCredentials(username: string, password: string) {
  return (
    safeEquals(String(username || '').trim(), getViewerUsername()) &&
    safeEquals(String(password || ''), getViewerPassword())
  );
}

export async function isPocketBaseViewerAuthenticated() {
  const store = await cookies();
  const value = store.get(VIEWER_COOKIE_NAME)?.value || '';
  return safeEquals(value, buildSessionToken());
}

export async function createPocketBaseViewerSession() {
  const store = await cookies();
  store.set(VIEWER_COOKIE_NAME, buildSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
}

export async function clearPocketBaseViewerSession() {
  const store = await cookies();
  store.set(VIEWER_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export function getPocketBaseViewerUsername() {
  return getViewerUsername();
}
