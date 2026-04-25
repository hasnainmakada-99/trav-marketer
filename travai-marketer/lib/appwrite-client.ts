/**
 * Appwrite Client-Side SDK
 * 
 * Used in browser/client components for real-time features and authentication.
 */

import { Client, Account, Databases } from 'appwrite';

let client: Client | null = null;
let accountInstance: Account | null = null;
let databases: Databases | null = null;

function getClient(): Client {
  if (!client) {
    client = new Client()
      .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
      .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || '');
  }
  return client;
}

export function getAccountClient(): Account {
  if (!accountInstance) {
    accountInstance = new Account(getClient());
  }
  return accountInstance;
}

export const account = getAccountClient();

export function getDatabaseClient(): Databases {
  if (!databases) {
    databases = new Databases(getClient());
  }
  return databases;
}

export const APPWRITE_DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'travai';

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

export async function getCurrentUser() {
  try {
    const accountClient = getAccountClient();
    return await accountClient.get();
  } catch (error) {
    return null;
  }
}

export async function login(email: string, password: string) {
  const accountClient = getAccountClient();
  return await accountClient.createEmailSession(email, password);
}

export async function logout() {
  const accountClient = getAccountClient();
  return await accountClient.deleteSession('current');
}

export async function register(email: string, password: string, name: string) {
  const accountClient = getAccountClient();
  return await accountClient.create('unique()', email, password, name);
}

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
  const db = getDatabaseClient();
  return await db.listDocuments(
    APPWRITE_DATABASE_ID,
    collectionId,
    queries
  );
}

export async function getDocument(
  collectionId: string,
  documentId: string
) {
  const db = getDatabaseClient();
  return await db.getDocument(
    APPWRITE_DATABASE_ID,
    collectionId,
    documentId
  );
}
