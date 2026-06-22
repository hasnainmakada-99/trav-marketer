import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config as loadDotenv } from 'dotenv';
import PocketBase from 'pocketbase';
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

const baseUrl = (process.env.POCKETBASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
const email = (process.env.POCKETBASE_SUPERUSER_EMAIL || '').trim();
const password = (process.env.POCKETBASE_SUPERUSER_PASSWORD || '').trim();
const cacheFile =
  process.env.LOCAL_CRM_CACHE_IMPORT_FILE ||
  path.join(APP_DIR, '.local-cache', 'local-crm-store.json');

if (!email || !password) {
  throw new Error('Missing POCKETBASE_SUPERUSER_EMAIL or POCKETBASE_SUPERUSER_PASSWORD');
}

const schemaMap = new Map(schema.collections.map((collection) => [collection.name, collection]));
const pb = new PocketBase(baseUrl);
pb.autoCancellation(false);

function looksLikePocketBaseId(value) {
  return /^[a-z0-9]{15}$/i.test(String(value || ''));
}

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

async function upsertRecord(collectionId, record) {
  const payload = transformRecord(collectionId, record);
  if (!payload.id && !payload.appwriteId) {
    return false;
  }

  const existing = await findExistingRecord(collectionId, payload);
  if (existing) {
    await pb.collection(collectionId).update(existing.id, payload);
    return 'updated';
  }

  await pb.collection(collectionId).create(payload);
  return 'created';
}

async function main() {
  if (!fs.existsSync(cacheFile)) {
    throw new Error(`Cache file not found: ${cacheFile}`);
  }

  await pb.collection('_superusers').authWithPassword(email, password);

  const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const collections = parsed?.collections || {};
  const summary = {};

  for (const [collectionId, records] of Object.entries(collections)) {
    if (!schemaMap.has(collectionId) || !Array.isArray(records)) {
      continue;
    }

    let created = 0;
    let updated = 0;

    for (const record of records) {
      const result = await upsertRecord(collectionId, record);
      if (result === 'created') created += 1;
      if (result === 'updated') updated += 1;
    }

    summary[collectionId] = { total: records.length, created, updated };
    console.log(`${collectionId}: ${records.length} imported (${created} created, ${updated} updated)`);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('[migrate-local-cache-to-pocketbase] failed:', error);
  process.exit(1);
});
