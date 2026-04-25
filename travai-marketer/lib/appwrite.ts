/**
 * Appwrite Server-Side Client
 * 
 * Used in API routes and server actions.
 * Make sure to validate user authorization before using this.
 */

import { Client, Databases, Users, Avatars, Storage } from 'node-appwrite';

let client: Client | null = null;
let databases: Databases | null = null;
let users: Users | null = null;
let avatars: Avatars | null = null;
let storage: Storage | null = null;

function getClient(): Client {
  if (!client) {
    client = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
      .setProject(process.env.APPWRITE_PROJECT_ID || '')
      .setKey(process.env.APPWRITE_API_KEY || '');
  }
  return client;
}

export function getDatabaseClient(): Databases {
  if (!databases) {
    databases = new Databases(getClient());
  }
  return databases;
}

export function getUsersClient(): Users {
  if (!users) {
    users = new Users(getClient());
  }
  return users;
}

export function getAvatarsClient(): Avatars {
  if (!avatars) {
    avatars = new Avatars(getClient());
  }
  return avatars;
}

export function getStorageClient(): Storage {
  if (!storage) {
    storage = new Storage(getClient());
  }
  return storage;
}

export const APPWRITE_DATABASE_ID = process.env.APPWRITE_DATABASE_ID || 'travai';

// ============================================================================
// DATABASE COLLECTION IDS
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
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a document in Appwrite
 */
export async function createDocument(
  collectionId: string,
  data: Record<string, any>,
  documentId?: string
) {
  const db = getDatabaseClient();
  const id = documentId || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  return await db.createDocument(
    APPWRITE_DATABASE_ID,
    collectionId,
    id,
    data
  );
}

/**
 * Get a document from Appwrite
 */
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

/**
 * List documents with filtering
 */
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

/**
 * Update a document
 */
export async function updateDocument(
  collectionId: string,
  documentId: string,
  data: Record<string, any>
) {
  const db = getDatabaseClient();
  return await db.updateDocument(
    APPWRITE_DATABASE_ID,
    collectionId,
    documentId,
    data
  );
}

/**
 * Delete a document
 */
export async function deleteDocument(
  collectionId: string,
  documentId: string
) {
  const db = getDatabaseClient();
  return await db.deleteDocument(
    APPWRITE_DATABASE_ID,
    collectionId,
    documentId
  );
}

/**
 * Query helper
 * Usage: buildQuery('teamId', '==', 'team-123')
 */
export function buildQuery(
  attribute: string,
  operator: string,
  value: string | number | boolean
): string {
  if (typeof value === 'string') {
    return `${attribute}${operator}"${value}"`;
  }
  return `${attribute}${operator}${value}`;
}
