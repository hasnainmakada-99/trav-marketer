import PocketBase from 'pocketbase';
import pocketBaseSchema from '@/pocketbase/schema.json';

type PocketBaseField = {
  name: string;
  type: string;
  required?: boolean;
  max?: number;
  min?: number;
  maxSelect?: number;
  maxSize?: number;
  mimeTypes?: string[];
};

type PocketBaseCollectionSchema = {
  name: string;
  type: 'base' | 'auth' | 'view';
  fields: PocketBaseField[];
  indexes?: string[];
};

type ParsedQuery =
  | { method: 'equal'; attribute: string; values: unknown[] }
  | { method: 'limit'; value: number }
  | { method: 'offset'; value: number }
  | { method: 'orderAsc' | 'orderDesc'; attribute: string }
  | { method: 'greaterThan' | 'lessThan'; attribute: string; value: unknown }
  | { method: 'isNotNull'; attribute: string };

const collections = (pocketBaseSchema as { collections: PocketBaseCollectionSchema[] }).collections;
const collectionMap = new Map(collections.map((collection) => [collection.name, collection]));

let pocketBaseAdmin: PocketBase | null = null;
let pocketBaseAuthPromise: Promise<PocketBase> | null = null;

function getPocketBaseUrl() {
  return (process.env.POCKETBASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
}

function getPocketBasePublicUrl() {
  return (
    process.env.POCKETBASE_PUBLIC_URL ||
    process.env.POCKETBASE_URL ||
    'http://127.0.0.1:8090'
  ).replace(/\/+$/, '');
}

function getPocketBaseCredentials() {
  const email = (process.env.POCKETBASE_SUPERUSER_EMAIL || '').trim();
  const password = (process.env.POCKETBASE_SUPERUSER_PASSWORD || '').trim();
  if (!email || !password) {
    throw new Error('PocketBase superuser credentials are not configured');
  }
  return { email, password };
}

function parseQuery(rawQuery: string): ParsedQuery | null {
  if (!rawQuery || typeof rawQuery !== 'string') return null;
  try {
    const parsed = JSON.parse(rawQuery) as Record<string, unknown>;
    const method = String(parsed.method || '');
    const attribute = String(parsed.attribute || '');
    const values = Array.isArray(parsed.values) ? parsed.values : [];

    if (method === 'equal') {
      return { method, attribute, values };
    }
    if (method === 'limit') {
      return { method, value: Math.max(0, Number(values[0] ?? 0)) };
    }
    if (method === 'offset') {
      return { method, value: Math.max(0, Number(values[0] ?? 0)) };
    }
    if (method === 'orderAsc' || method === 'orderDesc') {
      return { method, attribute };
    }
    if (method === 'greaterThan' || method === 'lessThan') {
      return { method, attribute, value: values[0] };
    }
    if (method === 'isNotNull') {
      return { method, attribute };
    }
  } catch {
    return null;
  }
  return null;
}

function getFieldSchema(collectionId: string, fieldName: string) {
  return collectionMap.get(collectionId)?.fields.find((field) => field.name === fieldName) || null;
}

function mapFieldName(collectionId: string, attribute: string) {
  if (attribute === '$id') return 'id';
  if (attribute === '$createdAt') {
    return getFieldSchema(collectionId, 'createdAt') ? 'createdAt' : 'created';
  }
  if (attribute === '$updatedAt') {
    return getFieldSchema(collectionId, 'updatedAt') ? 'updatedAt' : 'updated';
  }
  return attribute;
}

function escapeFilterValue(value: unknown) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function buildListOptions(collectionId: string, queries: string[]) {
  let limit = 100;
  let offset = 0;
  let sort = '';
  const filters: string[] = [];

  for (const rawQuery of queries) {
    const query = parseQuery(rawQuery);
    if (!query) continue;

    if (query.method === 'equal') {
      const field = mapFieldName(collectionId, query.attribute);
      if (!query.values.length) {
        filters.push('id = ""');
      } else if (query.values.length === 1) {
        filters.push(`${field} = "${escapeFilterValue(query.values[0])}"`);
      } else {
        filters.push(
          `(${query.values.map((value) => `${field} = "${escapeFilterValue(value)}"`).join(' || ')})`
        );
      }
      continue;
    }

    if (query.method === 'limit') {
      limit = Math.max(1, Math.min(1000, query.value || 100));
      continue;
    }

    if (query.method === 'offset') {
      offset = Math.max(0, query.value || 0);
      continue;
    }

    if (query.method === 'orderAsc' || query.method === 'orderDesc') {
      const field = mapFieldName(collectionId, query.attribute);
      sort = `${query.method === 'orderDesc' ? '-' : '+'}${field}`;
      continue;
    }

    if (query.method === 'greaterThan' || query.method === 'lessThan') {
      const field = mapFieldName(collectionId, query.attribute);
      const operator = query.method === 'greaterThan' ? '>' : '<';
      filters.push(`${field} ${operator} "${escapeFilterValue(query.value)}"`);
      continue;
    }

    if (query.method === 'isNotNull') {
      const field = mapFieldName(collectionId, query.attribute);
      filters.push(`${field} != ""`);
    }
  }

  return {
    limit,
    offset,
    page: Math.floor(offset / Math.max(1, limit)) + 1,
    sort: sort || undefined,
    filter: filters.length ? filters.join(' && ') : undefined,
  };
}

function coerceForPocketBase(collectionId: string, key: string, value: unknown) {
  const field = getFieldSchema(collectionId, key);
  if (!field) {
    return value;
  }

  if (value === undefined) {
    return undefined;
  }

  if (field.type === 'json') {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value ?? null;
  }

  if (field.type === 'bool') {
    return Boolean(value);
  }

  if (field.type === 'number') {
    if (value === null || value === '') return 0;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  if (field.type === 'date') {
    return value ? String(value) : '';
  }

  if (field.type === 'file') {
    return value;
  }

  return value === null ? '' : value;
}

function normalizeInput(collectionId: string, data: Record<string, any>) {
  const normalized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    normalized[key] = coerceForPocketBase(collectionId, key, value);
  }
  return normalized;
}

function toAppwriteLikeRecord(collectionId: string, record: Record<string, any>) {
  const next = { ...record } as Record<string, any>;
  next.$id = record.id;
  next.$createdAt = record.created;
  next.$updatedAt = record.updated;
  next.$collectionId = collectionId;
  return next;
}

export function isPocketBaseConfigured() {
  return Boolean(
    process.env.POCKETBASE_URL &&
      process.env.POCKETBASE_SUPERUSER_EMAIL &&
      process.env.POCKETBASE_SUPERUSER_PASSWORD
  );
}

export async function getPocketBaseAdmin() {
  if (pocketBaseAdmin?.authStore.isValid) {
    return pocketBaseAdmin;
  }

  if (pocketBaseAuthPromise) {
    return pocketBaseAuthPromise;
  }

  pocketBaseAuthPromise = (async () => {
    const { email, password } = getPocketBaseCredentials();
    const pb = new PocketBase(getPocketBaseUrl());
    pb.autoCancellation(false);
    await pb.collection('_superusers').authWithPassword(email, password);
    pocketBaseAdmin = pb;
    return pb;
  })();

  try {
    return await pocketBaseAuthPromise;
  } finally {
    pocketBaseAuthPromise = null;
  }
}

export async function createPocketBaseDocument(
  collectionId: string,
  data: Record<string, any>,
  documentId?: string
) {
  const pb = await getPocketBaseAdmin();
  const payload = normalizeInput(collectionId, data);
  if (documentId) {
    payload.id = documentId;
  }
  const record = await pb.collection(collectionId).create(payload);
  return toAppwriteLikeRecord(collectionId, record as Record<string, any>);
}

export async function getPocketBaseDocument(collectionId: string, documentId: string) {
  const pb = await getPocketBaseAdmin();
  const record = await pb.collection(collectionId).getOne(documentId);
  return toAppwriteLikeRecord(collectionId, record as Record<string, any>);
}

export async function listPocketBaseDocuments(collectionId: string, queries: string[] = []) {
  const pb = await getPocketBaseAdmin();
  const options = buildListOptions(collectionId, queries);

  if (options.offset > 0 && options.offset % options.limit !== 0) {
    const records = await pb.collection(collectionId).getFullList({
      filter: options.filter,
      sort: options.sort,
    });
    const sliced = records.slice(options.offset, options.offset + options.limit);
    return {
      total: records.length,
      documents: sliced.map((record) =>
        toAppwriteLikeRecord(collectionId, record as Record<string, any>)
      ),
    };
  }

  const page = await pb.collection(collectionId).getList(options.page, options.limit, {
    filter: options.filter,
    sort: options.sort,
  });

  return {
    total: page.totalItems,
    documents: page.items.map((record) =>
      toAppwriteLikeRecord(collectionId, record as Record<string, any>)
    ),
  };
}

export async function updatePocketBaseDocument(
  collectionId: string,
  documentId: string,
  data: Record<string, any>
) {
  const pb = await getPocketBaseAdmin();
  const record = await pb.collection(collectionId).update(
    documentId,
    normalizeInput(collectionId, data)
  );
  return toAppwriteLikeRecord(collectionId, record as Record<string, any>);
}

export async function deletePocketBaseDocument(collectionId: string, documentId: string) {
  const pb = await getPocketBaseAdmin();
  await pb.collection(collectionId).delete(documentId);
  return { $id: documentId };
}

export function buildPocketBaseFileUrl(collectionId: string, recordId: string, fileName: string) {
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    getPocketBasePublicUrl()
  ).replace(/\/+$/, '');
  return `${appUrl}/api/media/pb/${encodeURIComponent(collectionId)}/${encodeURIComponent(recordId)}/${encodeURIComponent(fileName)}`;
}

export async function uploadPocketBaseMediaFiles(teamId: string, files: File[]) {
  const pb = await getPocketBaseAdmin();
  const uploaded: Array<Record<string, any>> = [];

  for (const file of files) {
    const now = new Date().toISOString();
    const form = new FormData();
    form.append('teamId', teamId);
    form.append('fileName', file.name);
    form.append('mimeType', file.type || '');
    form.append('size', String(file.size || 0));
    form.append('mediaFormat', file.type.startsWith('video/') ? 'VIDEO' : 'PHOTO');
    form.append('createdAt', now);
    form.append('updatedAt', now);
    form.append('asset', file);

    const record = (await pb.collection('gbp_media').create(form)) as unknown as Record<string, any>;
    const fileField = Array.isArray(record.asset) ? record.asset[0] : record.asset;

    uploaded.push({
      fileId: record.id,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      teamId,
      mediaFormat: file.type.startsWith('video/') ? 'VIDEO' : 'PHOTO',
      publicUrl: buildPocketBaseFileUrl('gbp_media', record.id, String(fileField || '')),
    });
  }

  return uploaded;
}

export function getPocketBaseSchema() {
  return collections;
}
