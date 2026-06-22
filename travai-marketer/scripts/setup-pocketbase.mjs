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

if (!email || !password) {
  throw new Error('Missing POCKETBASE_SUPERUSER_EMAIL or POCKETBASE_SUPERUSER_PASSWORD');
}

const pb = new PocketBase(baseUrl);
pb.autoCancellation(false);

function buildCollectionBody(collection) {
  return {
    name: collection.name,
    type: collection.type || 'base',
    fields: collection.fields || [],
    indexes: collection.indexes || [],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  };
}

async function main() {
  await pb.collection('_superusers').authWithPassword(email, password);

  for (const collection of schema.collections) {
    const payload = buildCollectionBody(collection);
    try {
      const existing = await pb.collections.getOne(collection.name);
      await pb.collections.update(existing.id, payload);
      console.log(`updated collection ${collection.name}`);
    } catch (error) {
      const message = String(error?.message || '');
      if (message.includes('404') || message.toLowerCase().includes('not found')) {
        await pb.collections.create(payload);
        console.log(`created collection ${collection.name}`);
      } else {
        throw error;
      }
    }
  }
}

main().catch((error) => {
  console.error('[setup-pocketbase] failed:', error);
  process.exit(1);
});
