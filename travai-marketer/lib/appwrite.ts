/**
 * Data Access Layer
 *
 * All CRUD operations route through PocketBase. This file provides a stable
 * interface so existing callers don't need to change their imports.
 */

import {
  createPocketBaseDocument,
  deletePocketBaseDocument,
  getPocketBaseDocument,
  listPocketBaseDocuments,
  updatePocketBaseDocument,
} from '@/lib/pocketbase-server';
import {
  getLocalDocument,
  queryLocalDocuments,
  upsertLocalDocument,
  removeLocalDocument,
} from '@/lib/local-crm-cache';

// Keep for backward compatibility — all actual routing goes to PocketBase
export const APPWRITE_DATABASE_ID = process.env.APPWRITE_DATABASE_ID || 'travai';

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

export async function createDocument(
  collectionId: string,
  data: Record<string, any>,
  documentId?: string
) {
  const created = await createPocketBaseDocument(collectionId, data, documentId);
  await upsertLocalDocument(collectionId, created as Record<string, any>).catch(() => null);
  return created;
}

export async function getDocument(collectionId: string, documentId: string) {
  const document = await getPocketBaseDocument(collectionId, documentId);
  await upsertLocalDocument(collectionId, document as Record<string, any>).catch(() => null);
  return document;
}

export async function listDocuments(collectionId: string, queries: string[] = []) {
  const result = await listPocketBaseDocuments(collectionId, queries);
  await Promise.all(
    ((result.documents || []) as Array<Record<string, any>>).map((document) =>
      upsertLocalDocument(collectionId, document).catch(() => null)
    )
  );
  return result;
}

export async function updateDocument(
  collectionId: string,
  documentId: string,
  data: Record<string, any>
) {
  const updated = await updatePocketBaseDocument(collectionId, documentId, data);
  await upsertLocalDocument(collectionId, updated as Record<string, any>).catch(() => null);
  return updated;
}

export async function deleteDocument(collectionId: string, documentId: string) {
  const deleted = await deletePocketBaseDocument(collectionId, documentId);
  await removeLocalDocument(collectionId, documentId).catch(() => null);
  return deleted;
}

export function getPublicFileViewUrl(_bucketId: string, _fileId: string): string {
  throw new Error('Appwrite storage is not available. Media is served through PocketBase.');
}
