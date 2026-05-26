/**
 * Deletes all test/fake leads, their conversations, and customer records.
 * Matches on test phone patterns AND test name keywords.
 * Run: node --env-file=.env scripts/cleanup-test-data.mjs
 */
import { Client, Databases, Query } from 'node-appwrite';

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const db = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID;

async function listAll(collectionId, queries = []) {
  const docs = [];
  let offset = 0;
  while (true) {
    const res = await db.listDocuments(DB_ID, collectionId, [
      ...queries,
      Query.limit(100),
      Query.offset(offset),
    ]);
    docs.push(...res.documents);
    if (docs.length >= res.total || res.documents.length === 0) break;
    offset += res.documents.length;
  }
  return docs;
}

async function deleteDoc(col, id) {
  try { await db.deleteDocument(DB_ID, col, id); return true; }
  catch { return false; }
}

// Phone number patterns that are clearly fake/test
function isTestPhone(phone) {
  if (!phone) return false;
  const p = String(phone).replace(/\D/g, '');
  // All same digit repeated: 9999999, 0000000, 1111111
  if (/^(\d)\1{6,}$/.test(p)) return true;
  // Starts with country code then long run of same digit
  if (/^(91|1)\d*(9{6,}|0{6,}|1{6,})$/.test(p)) return true;
  // Known fake prefixes in the data
  if (/^91999(9{4,}|000\d{4})/.test(p)) return true;
  if (/^9196000000/.test(p)) return true;
  if (/^9191{6,}/.test(p)) return true;
  if (/^919999001/.test(p)) return true;
  // Short/clearly invalid numbers
  if (p.length < 8 || p.length > 15) return true;
  return false;
}

// Name keywords that indicate test entries
const TEST_NAME_KEYWORDS = [
  'test', 'retest', 'probe', 'trigger', 'e2e', 'whitelist',
  'manual', 'dummy', 'fake', 'sandbox', 'debug',
];

function isTestName(name) {
  if (!name) return false;
  const n = name.toLowerCase();
  return TEST_NAME_KEYWORDS.some(k => n.includes(k));
}

const leads = await listAll('leads');
console.log(`Total leads: ${leads.length}\n`);

const testLeads = leads.filter(l => isTestPhone(l.phone) || isTestName(l.name));
console.log(`Test leads found: ${testLeads.length}`);

if (testLeads.length === 0) {
  console.log('Nothing to delete.'); process.exit(0);
}

const testPhones = new Set(testLeads.map(l => l.phone).filter(Boolean));

// Delete conversations for test phones
let convDeleted = 0;
for (const phone of testPhones) {
  const convos = await listAll('conversations', [Query.equal('phone', phone)]);
  for (const c of convos) {
    if (await deleteDoc('conversations', c.$id)) convDeleted++;
  }
}
console.log(`Conversations deleted: ${convDeleted}`);

// Delete customer records for test phones
let custDeleted = 0;
for (const phone of testPhones) {
  const custs = await listAll('customers', [Query.equal('phone', phone)]);
  for (const c of custs) {
    if (await deleteDoc('customers', c.$id)) custDeleted++;
  }
}
console.log(`Customer records deleted: ${custDeleted}`);

// Delete the leads
let leadDeleted = 0;
console.log('\nDeleting leads:');
for (const lead of testLeads) {
  const ok = await deleteDoc('leads', lead.$id);
  if (ok) {
    console.log(`  ✓ [${lead.name || 'Unknown'}] ${lead.phone}`);
    leadDeleted++;
  } else {
    console.log(`  ✗ Failed: ${lead.phone}`);
  }
}

console.log(`\nDone. Leads: ${leadDeleted} deleted. Real leads remaining: ${leads.length - leadDeleted}`);
