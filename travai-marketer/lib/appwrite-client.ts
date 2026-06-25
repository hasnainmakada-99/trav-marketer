/**
 * Legacy client auth shim.
 *
 * This file keeps the old import path stable while the app now authenticates
 * against PocketBase-backed dashboard session routes instead of Appwrite.
 */

type ClientUser = {
  $id: string;
  name: string;
  email: string;
};

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(String((data as { error?: string }).error || 'Request failed'));
  }
  return data;
}

// ============================================================================
// COLLECTIONS
// ============================================================================

export const COLLECTIONS = {
  BUSINESS_CONFIGS: 'business_configs',
  CUSTOMERS: 'customers',
  CONVERSATIONS: 'conversations',
  LEADS: 'leads',
  CAMPAIGNS: 'campaigns',
  CAMPAIGN_LOGS: 'campaign_logs',
  GBP_POSTS: 'gbp_posts',
  GBP_REVIEWS: 'gbp_reviews',
  STAFF: 'staff',
} as const;

// ============================================================================
// AUTHENTICATION
// ============================================================================

export async function getCurrentUser(): Promise<ClientUser | null> {
  try {
    const data = await requestJson<{ authenticated?: boolean; user?: ClientUser | null }>(
      '/api/auth/session',
      { method: 'GET' }
    );
    return data.user || null;
  } catch {
    return null;
  }
}

export async function login(email: string, password: string) {
  const data = await requestJson<{ user: ClientUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return data.user;
}

export async function logout() {
  return await requestJson<{ success: boolean }>('/api/auth/logout', {
    method: 'POST',
  });
}

export async function register(email: string, password: string, name: string) {
  void password;
  throw new Error(
    `Self-service registration is disabled. Ask an admin to create PocketBase access for ${name || email}.`
  );
}

export const account = {
  async get() {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('Unauthorized');
    }
    return user;
  },
  async createEmailSession(email: string, password: string) {
    return await login(email, password);
  },
  async deleteSession(sessionId: string) {
    void sessionId;
    return await logout();
  },
};

// ============================================================================
// REAL-TIME SUBSCRIPTIONS (Coming in Phase 2 - requires Realtime API)
// ============================================================================
// Real-time subscriptions will be implemented in Phase 2 after Realtime API is available

/*
export function subscribeToCollection(
  collectionId: string,
  callback: (data: any) => void
): () => void {
  // TODO: Implement real-time subscriptions
  return () => {};
}

export function subscribeToDocument(
  collectionId: string,
  documentId: string,
  callback: (data: any) => void
): () => void {
  // TODO: Implement real-time subscriptions
  return () => {};
}
*/

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

export async function listDocuments(
  collectionId: string,
  queries: string[] = []
) {
  void queries;
  throw new Error(
    `Client-side direct collection reads are disabled for ${collectionId}. Use server routes instead.`
  );
}

export async function getDocument(
  collectionId: string,
  documentId: string
) {
  throw new Error(`Client-side direct document reads are disabled for ${collectionId}:${documentId}.`);
}
