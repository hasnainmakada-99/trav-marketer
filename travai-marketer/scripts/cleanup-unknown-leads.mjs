/**
 * Deletes all Unknown-name leads + known dev test numbers.
 * Run: node --env-file=.env scripts/cleanup-unknown-leads.mjs
 */
import { Client, Databases, Query } from 'node-appwrite';

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);
const db = new Databases(client);
const DB = process.env.APPWRITE_DATABASE_ID;

// Dev/test phone numbers that should never be leads
const TEST_PHONES = new Set(['919638226174', '92028415250547', '919999991111']);

async function listAll(col, q = []) {
  const docs = []; let off = 0;
  while (true) {
    const r = await db.listDocuments(DB, col, [...q, Query.limit(100), Query.offset(off)]);
    docs.push(...r.documents);
    if (docs.length >= r.total || r.documents.length === 0) break;
    off += r.documents.length;
  }
  return docs;
}

async function del(col, id) {
  try { await db.deleteDocument(DB, col, id); return true; } catch { return false; }
}

const leads = await listAll('leads');
const toDelete = leads.filter(l => {
  const phone = String(l.phone || '').replace(/\D/g, '');
  return !l.name || TEST_PHONES.has(phone);
});

console.log(`Total leads: ${leads.length} | To delete: ${toDelete.length}`);

const phones = new Set(toDelete.map(l => l.phone).filter(Boolean));
let cv = 0, cu = 0, ld = 0;

for (const p of phones) {
  const convos = await listAll('conversations', [Query.equal('phone', p)]);
  for (const c of convos) if (await del('conversations', c.$id)) cv++;
  const custs = await listAll('customers', [Query.equal('phone', p)]);
  for (const c of custs) if (await del('customers', c.$id)) cu++;
}

for (const l of toDelete) {
  if (await del('leads', l.$id)) {
    console.log(`  ✓ [${l.name || 'Unknown'}] ${l.phone} | "${String(l.notes || '').slice(0, 50)}"`);
    ld++;
  }
}

console.log(`\nDeleted — Leads: ${ld}, Convos: ${cv}, Customers: ${cu}`);

const remaining = await listAll('leads');
console.log(`\nReal leads remaining: ${remaining.length}`);
for (const l of remaining) {
  console.log(`  • [${l.name}] ${l.phone} | "${String(l.notes || '').slice(0, 60)}"`);
}
