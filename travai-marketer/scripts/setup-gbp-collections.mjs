import { Client, Databases, Query } from 'node-appwrite';

const client = new Client()
  .setEndpoint('https://sfo.cloud.appwrite.io/v1')
  .setProject('696e73130021efc7a514')
  .setKey('standard_3fdd6fc4b8a1ffbd9c56842fbd82b6c48a0fb610c65784b54b9aebba5676d1d49dbc601bf894037b290579ffd5fd8cca17fb7624718e46e1bb5f9e260e043f01421c3e98dcaa1758141476fe9b7df0f8361a7987b3f7851314388e87f4366ad1283d637475b8a495e3fbf57c9c249db599f4a3c16a53fc9cbe429e5a4ea36094');

const db = new Databases(client);
const DB = 'travai';

async function fixCollection(colId, desiredAttrs, indexes) {
  console.log(`\n── ${colId} ──`);
  let col;
  try {
    col = await db.getCollection(DB, colId);
    console.log(`  Found: ${col.name}`);
  } catch {
    console.log(`  Collection not found — skipping`);
    return;
  }

  const existingKeys = new Set(col.attributes.map(a => a.key));
  const existingIdxKeys = new Set(col.indexes.map(i => i.key));

  // Fix any required attributes to optional
  for (const attr of col.attributes) {
    if (attr.required && !attr.array) {
      try {
        await db.updateStringAttribute(DB, colId, attr.key, false, '');
        console.log(`  [MADE OPTIONAL] "${attr.key}"`);
      } catch (e) {
        // ignore — might already be optional or unsupported
      }
    }
  }

  // Add missing attributes
  for (const [key, size] of desiredAttrs) {
    if (existingKeys.has(key)) continue;
    try {
      await db.createStringAttribute(DB, colId, key, size, false);
      console.log(`  [CREATED attr] "${key}" (size=${size})`);
    } catch (err) {
      console.error(`  [ERR attr] "${key}": ${err.message}`);
    }
  }

  // Wait for attrs
  await new Promise(r => setTimeout(r, 6000));

  // Add missing indexes
  for (const [key, type, attrs, orders] of indexes) {
    if (existingIdxKeys.has(key)) continue;
    try {
      await db.createIndex(DB, colId, key, type, attrs, orders);
      console.log(`  [CREATED idx] "${key}"`);
    } catch (err) {
      console.error(`  [ERR idx] "${key}": ${err.message}`);
    }
  }
}

// gbp_posts attributes
await fixCollection('gbp_posts', [
  ['teamId',       255],
  ['title',        512],
  ['content',     4000],
  ['status',        50],
  ['googlePostId', 512],
  ['postedAt',      50],
  ['type',         100],
  ['createdBy',    255],
  ['createdAt',     50],
  ['updatedAt',     50],
  ['mediaJson',   4000],
  ['callToActionJson', 2000],
  ['languageCode', 50],
  ['googleState', 100],
  ['googleSearchUrl', 1000],
  ['syncSource', 100],
], [
  ['idx_teamId', 'key', ['teamId'], ['ASC']],
  ['idx_status', 'key', ['status'], ['ASC']],
]);

// gbp_reviews attributes
await fixCollection('gbp_reviews', [
  ['teamId',         255],
  ['googleReviewId', 512],
  ['reviewer',       255],
  ['rating',          10],
  ['reviewText',    4000],
  ['reply',         4000],
  ['replyStatus',     50],
  ['repliedAt',       50],
  ['createdAt',       50],
  ['updatedAt',       50],
], [
  ['idx_teamId',      'key', ['teamId'],      ['ASC']],
  ['idx_replyStatus', 'key', ['replyStatus'], ['ASC']],
]);

// Verify business_configs has googleLocationId and is readable
console.log('\n── business_configs (verify) ──');
try {
  const list = await db.listDocuments(DB, 'business_configs', [Query.limit(3)]);
  console.log(`  Docs: ${list.total}`);
  for (const doc of list.documents) {
    console.log(`  - teamId: ${doc.teamId}, hasToken: ${!!doc.googleAccessToken}, locationId: ${doc.googleLocationId || '(none)'}`);
  }
} catch (err) {
  console.error('  Read failed:', err.message);
}

console.log('\nAll GBP collections ready.');
