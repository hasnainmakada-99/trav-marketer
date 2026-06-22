/**
 * Appwrite Server-Side Client
 * 
 * Used in API routes and server actions.
 * Make sure to validate user authorization before using this.
 */

import { Client, Databases, Users, Avatars, Storage } from 'node-appwrite';
import {
  getActiveDataBackend,
  shouldMirrorWritesToPocketBase,
} from '@/lib/data-backend';
import {
  getLocalDocument,
  isAppwriteReadLimitError,
  queryLocalDocuments,
  removeLocalDocument,
  upsertLocalDocument,
} from '@/lib/local-crm-cache';
import {
  createPocketBaseDocument,
  deletePocketBaseDocument,
  getPocketBaseDocument,
  isPocketBaseConfigured,
  listPocketBaseDocuments,
  updatePocketBaseDocument,
} from '@/lib/pocketbase-server';

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

export const STORAGE_BUCKETS = {
  GBP_MEDIA:
    process.env.APPWRITE_GBP_MEDIA_BUCKET_ID ||
    process.env.APPWRITE_MEDIA_BUCKET_ID ||
    '696e9d5f0032436becb7',
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
  if (getActiveDataBackend() === 'pocketbase') {
    const created = await createPocketBaseDocument(collectionId, data, documentId);
    await upsertLocalDocument(collectionId, created as Record<string, any>).catch(() => null);
    return created;
  }

  const db = getDatabaseClient();
  const id = documentId || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const created = await db.createDocument(
    APPWRITE_DATABASE_ID,
    collectionId,
    id,
    data
  );
  if (shouldMirrorWritesToPocketBase() && isPocketBaseConfigured()) {
    await createPocketBaseDocument(collectionId, data, created.$id).catch(() => null);
  }
  await upsertLocalDocument(collectionId, created as Record<string, any>).catch(() => null);
  return created;
}

/**
 * Get a document from Appwrite
 */
export async function getDocument(
  collectionId: string,
  documentId: string
) {
  if (getActiveDataBackend() === 'pocketbase') {
    const document = await getPocketBaseDocument(collectionId, documentId);
    await upsertLocalDocument(collectionId, document as Record<string, any>).catch(() => null);
    return document;
  }

  const db = getDatabaseClient();
  try {
    const document = await db.getDocument(
      APPWRITE_DATABASE_ID,
      collectionId,
      documentId
    );
    await upsertLocalDocument(collectionId, document as Record<string, any>).catch(() => null);
    return document;
  } catch (error) {
    if (isAppwriteReadLimitError(error)) {
      const localDocument = await getLocalDocument(collectionId, documentId);
      if (localDocument) {
        return localDocument;
      }
    }
    throw error;
  }
}

/**
 * List documents with filtering
 */
export async function listDocuments(
  collectionId: string,
  queries: string[] = []
) {
  if (getActiveDataBackend() === 'pocketbase') {
    const result = await listPocketBaseDocuments(collectionId, queries);
    await Promise.all(
      ((result.documents || []) as Array<Record<string, any>>).map((document) =>
        upsertLocalDocument(collectionId, document).catch(() => null)
      )
    );
    return result;
  }

  const db = getDatabaseClient();
  try {
    const result = await db.listDocuments(
      APPWRITE_DATABASE_ID,
      collectionId,
      queries
    );
    await Promise.all(
      ((result.documents || []) as Array<Record<string, any>>).map((document) =>
        upsertLocalDocument(collectionId, document).catch(() => null)
      )
    );
    return result;
  } catch (error) {
    if (isAppwriteReadLimitError(error)) {
      return await queryLocalDocuments(collectionId, queries);
    }
    throw error;
  }
}

/**
 * Update a document
 */
export async function updateDocument(
  collectionId: string,
  documentId: string,
  data: Record<string, any>
) {
  if (getActiveDataBackend() === 'pocketbase') {
    const updated = await updatePocketBaseDocument(collectionId, documentId, data);
    await upsertLocalDocument(collectionId, updated as Record<string, any>).catch(() => null);
    return updated;
  }

  const db = getDatabaseClient();
  const updated = await db.updateDocument(
    APPWRITE_DATABASE_ID,
    collectionId,
    documentId,
    data
  );
  if (shouldMirrorWritesToPocketBase() && isPocketBaseConfigured()) {
    await updatePocketBaseDocument(collectionId, documentId, data).catch(async () => {
      await createPocketBaseDocument(collectionId, data, documentId).catch(() => null);
    });
  }
  await upsertLocalDocument(collectionId, updated as Record<string, any>).catch(() => null);
  return updated;
}

/**
 * Delete a document
 */
export async function deleteDocument(
  collectionId: string,
  documentId: string
) {
  if (getActiveDataBackend() === 'pocketbase') {
    const deleted = await deletePocketBaseDocument(collectionId, documentId);
    await removeLocalDocument(collectionId, documentId).catch(() => null);
    return deleted;
  }

  const db = getDatabaseClient();
  const deleted = await db.deleteDocument(
    APPWRITE_DATABASE_ID,
    collectionId,
    documentId
  );
  if (shouldMirrorWritesToPocketBase() && isPocketBaseConfigured()) {
    await deletePocketBaseDocument(collectionId, documentId).catch(() => null);
  }
  await removeLocalDocument(collectionId, documentId).catch(() => null);
  return deleted;
}

export function getPublicFileViewUrl(bucketId: string, fileId: string): string {
  const endpoint = (
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ||
    process.env.APPWRITE_ENDPOINT ||
    'https://cloud.appwrite.io/v1'
  ).replace(/\/+$/, '');
  const projectId =
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ||
    process.env.APPWRITE_PROJECT_ID ||
    '';

  const url = new URL(`${endpoint}/storage/buckets/${bucketId}/files/${fileId}/view`);
  if (projectId) {
    url.searchParams.set('project', projectId);
  }

  return url.toString();
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
