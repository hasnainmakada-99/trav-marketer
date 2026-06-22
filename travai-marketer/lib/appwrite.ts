/**
 * Appwrite Server-Side Client
 * 
 * Used in API routes and server actions.
 * Make sure to validate user authorization before using this.
 */

import { Client, Databases, Users, Avatars, Storage } from 'node-appwrite';
import {
  getActiveDataBackend,
  shouldUsePocketBaseForCollection,
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
let fallbackBusinessConfigSeeded = false;
let fallbackBusinessConfigSeedPromise: Promise<void> | null = null;

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

function buildFallbackBusinessConfig() {
  const teamId = (process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || '').trim();
  if (!teamId) {
    return null;
  }

  const now = new Date(0).toISOString();

  return {
    $id: `env-business-config-${teamId}`,
    teamId,
    businessName: (process.env.TRAVENTIONS_BUSINESS_NAME || 'Traventions').trim(),
    openaiSystemPrompt: (process.env.WHATSAPP_OPENAI_SYSTEM_PROMPT || '').trim(),
    whatsappToken: (process.env.WHATSAPP_TOKEN || '').trim() || null,
    whatsappPhoneNumberId: (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim() || null,
    whatsappVerifyToken: (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim() || null,
    createdAt: now,
    updatedAt: now,
    $createdAt: now,
    $updatedAt: now,
  };
}

async function ensureFallbackBusinessConfigCached(collectionId: string) {
  if (collectionId !== COLLECTIONS.BUSINESS_CONFIGS) {
    return;
  }

  if (fallbackBusinessConfigSeeded) {
    return;
  }

  if (fallbackBusinessConfigSeedPromise) {
    return fallbackBusinessConfigSeedPromise;
  }

  fallbackBusinessConfigSeedPromise = (async () => {
    const fallbackConfig = buildFallbackBusinessConfig();
    if (fallbackConfig) {
      await upsertLocalDocument(COLLECTIONS.BUSINESS_CONFIGS, fallbackConfig).catch(() => null);
    }
    fallbackBusinessConfigSeeded = true;
  })();

  try {
    await fallbackBusinessConfigSeedPromise;
  } finally {
    fallbackBusinessConfigSeedPromise = null;
  }
}

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
  if (shouldUsePocketBaseForCollection(collectionId)) {
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
  await ensureFallbackBusinessConfigCached(collectionId);

  if (shouldUsePocketBaseForCollection(collectionId)) {
    const document = await getPocketBaseDocument(collectionId, documentId);
    await upsertLocalDocument(collectionId, document as Record<string, any>).catch(() => null);
    return document;
  }

  const localDocument = await getLocalDocument(collectionId, documentId);
  if (localDocument && collectionId === COLLECTIONS.BUSINESS_CONFIGS) {
    return localDocument;
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
  await ensureFallbackBusinessConfigCached(collectionId);

  if (shouldUsePocketBaseForCollection(collectionId)) {
    const result = await listPocketBaseDocuments(collectionId, queries);
    await Promise.all(
      ((result.documents || []) as Array<Record<string, any>>).map((document) =>
        upsertLocalDocument(collectionId, document).catch(() => null)
      )
    );
    return result;
  }

  if (collectionId === COLLECTIONS.BUSINESS_CONFIGS) {
    const localResult = await queryLocalDocuments(collectionId, queries).catch(() => ({
      total: 0,
      documents: [] as Array<Record<string, any>>,
    }));
    if ((localResult.documents || []).length > 0) {
      return localResult;
    }
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
  if (shouldUsePocketBaseForCollection(collectionId)) {
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
  if (shouldUsePocketBaseForCollection(collectionId)) {
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
