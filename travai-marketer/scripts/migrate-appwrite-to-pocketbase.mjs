import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config as loadDotenv } from 'dotenv';
import PocketBase from 'pocketbase';
import { Client, Databases, Query } from 'node-appwrite';
import schema from '../pocketbase/schema.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.resolve(__dirname, '..');

for (const candidate of ['.env', '.env.local']) {
  const fullPath = path.join(APP_DIR, candidate);
  if (fs.existsSync(fullPath)) {
    loadDotenv({ path: fullPath, override: false });
  }
}

const pbUrl = (process.env.POCKETBASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
const pbEmail = (process.env.POCKETBASE_SUPERUSER_EMAIL || '').trim();
const pbPassword = (process.env.POCKETBASE_SUPERUSER_PASSWORD || '').trim();
const appwriteEndpoint = (process.env.APPWRITE_ENDPOINT || '').trim();
const appwriteProjectId = (process.env.APPWRITE_PROJECT_ID || '').trim();
const appwriteApiKey = (process.env.APPWRITE_API_KEY || '').trim();
const appwriteDatabaseId = (process.env.APPWRITE_DATABASE_ID || 'travai').trim();

if (!pbEmail || !pbPassword) {
  throw new Error('Missing PocketBase superuser credentials');
}

if (!appwriteEndpoint || !appwriteProjectId || !appwriteApiKey) {
  throw new Error('Missing Appwrite credentials');
}

const schemaMap = new Map(schema.collections.map((collection) => [collection.name, collection]));
const pb = new PocketBase(pbUrl);
pb.autoCancellation(false);

function looksLikePocketBaseId(value) {
  return /^[a-z0-9]{15}$/i.test(String(value || ''));
}

const appwrite = new Client()
  .setEndpoint(appwriteEndpoint)
  .setProject(appwriteProjectId)
  .setKey(appwriteApiKey);
const db = new Databases(appwrite);

function coerceValue(field, value) {
  if (value === undefined) return undefined;
  if (field?.type === 'json') return value ?? null;
  if (field?.type === 'bool') return Boolean(value);
  if (field?.type === 'number') return value === null || value === '' ? 0 : Number(value || 0);
  if (field?.type === 'date') return value ? String(value) : '';
  return value === null ? '' : value;
}

function transformRecord(collectionId, record) {
  const collection = schemaMap.get(collectionId);
  const next = {};

  for (const field of collection?.fields || []) {
    const raw =
      record[field.name] ??
      (field.name === 'createdAt' ? record.$createdAt : undefined) ??
      (field.name === 'updatedAt' ? record.$updatedAt : undefined);
    if (raw !== undefined) {
      next[field.name] = coerceValue(field, raw);
    }
  }

  const sourceId = String(record.$id || record.id || '');
  if (sourceId) {
    next.appwriteId = sourceId;
    if (looksLikePocketBaseId(sourceId)) {
      next.id = sourceId;
    }
  }
  return next;
}

async function findExistingRecord(collectionId, payload) {
  if (payload.id) {
    try {
      return await pb.collection(collectionId).getOne(payload.id);
    } catch (error) {
      const status = Number(error?.status || 0);
      if (status !== 404) {
        throw error;
      }
    }
  }

  if (payload.appwriteId) {
    try {
      return await pb
        .collection(collectionId)
        .getFirstListItem(`appwriteId = "${String(payload.appwriteId).replace(/"/g, '\\"')}"`);
    } catch (error) {
      const status = Number(error?.status || 0);
      if (status !== 404) {
        throw error;
      }
    }
  }

  return null;
}

async function listAllDocuments(collectionId) {
  const all = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const page = await db.listDocuments(appwriteDatabaseId, collectionId, [
      Query.limit(pageSize),
      Query.offset(offset),
    ]);
    const documents = page.documents || [];
    all.push(...documents);
    if (documents.length < pageSize) {
      break;
    }
    offset += documents.length;
  }

  return all;
}

async function upsertPocketBaseRecord(collectionId, record) {
  const payload = transformRecord(collectionId, record);
  if (!payload.id && !payload.appwriteId) return false;

  const existing = await findExistingRecord(collectionId, payload);
  if (existing) {
    await pb.collection(collectionId).update(existing.id, payload);
    return 'updated';
  }

  await pb.collection(collectionId).create(payload);
  return 'created';
}

async function main() {
  await pb.collection('_superusers').authWithPassword(pbEmail, pbPassword);

  const collectionArg = (process.argv[2] || '').trim();
  const targetCollections = collectionArg
    ? collectionArg.split(',').map((value) => value.trim()).filter(Boolean)
    : schema.collections.map((collection) => collection.name);

  for (const collectionId of targetCollections) {
    if (!schemaMap.has(collectionId)) {
      console.warn(`Skipping unknown collection ${collectionId}`);
      continue;
    }

    const documents = await listAllDocuments(collectionId);
    let created = 0;
    let updated = 0;

    for (const document of documents) {
      const result = await upsertPocketBaseRecord(collectionId, document);
      if (result === 'created') created += 1;
      if (result === 'updated') updated += 1;
    }

    console.log(`${collectionId}: ${documents.length} migrated (${created} created, ${updated} updated)`);
  }
}

main().catch((error) => {
  console.error('[migrate-appwrite-to-pocketbase] failed:', error);
  process.exit(1);
});
