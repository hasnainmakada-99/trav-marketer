/**
 * Deletes leads where the notes are clearly spam/auto-replies/marketing,
 * and any lead where the phone is the Traventions own number.
 * Run: node --env-file=.env scripts/cleanup-spam-leads.mjs
 */
import { Client, Databases, Query } from 'node-appwrite';

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const db = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID;

// The Traventions own WhatsApp FROM number — must never be a lead
const OWN_PHONE = (process.env.YCLOUD_WHATSAPP_FROM || '').replace(/\D/g, '');

async function listAll(collectionId, queries = []) {
  const docs = [];
  let offset = 0;
  while (true) {
    const res = await db.listDocuments(DB_ID, collectionId, [
      ...queries, Query.limit(100), Query.offset(offset),
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

// Patterns in notes that indicate spam / auto-replies / marketing
const SPAM_PATTERNS = [
  /reach out to us/i,
  /thanks for reaching out/i,
  /slicebank/i,
  /cockpit/i,
  /visa services in-house/i,
  /new on cockpit/i,
  /handle flights.*visa/i,
  /automated (message|reply|response)/i,
  /out of office/i,
  /do not reply/i,
  /unsubscribe/i,
  /marketing/i,
  /\[document\]/i,
  /searching for answer/i,
  /^welcome!?$/i,
];

function isSpam(notes) {
  if (!notes) return false;
  return SPAM_PATTERNS.some(p => p.test(notes));
}

const leads = await listAll('leads');
console.log(`Total leads: ${leads.length}`);
if (OWN_PHONE) console.log(`Own phone (never a lead): ${OWN_PHONE}`);

const toDelete = leads.filter(l => {
  const phone = String(l.phone || '').replace(/\D/g, '');
  if (OWN_PHONE && phone === OWN_PHONE) return true;
  return isSpam(l.notes);
});

console.log(`Spam / self-number leads to delete: ${toDelete.length}`);
if (toDelete.length === 0) { console.log('Nothing to delete.'); process.exit(0); }

const phones = new Set(toDelete.map(l => l.phone).filter(Boolean));

let convDel = 0, custDel = 0, leadDel = 0;
for (const phone of phones) {
  const convos = await listAll('conversations', [Query.equal('phone', phone)]);
  for (const c of convos) if (await deleteDoc('conversations', c.$id)) convDel++;
  const custs = await listAll('customers', [Query.equal('phone', phone)]);
  for (const c of custs) if (await deleteDoc('customers', c.$id)) custDel++;
}

console.log(`\nDeleting leads:`);
for (const l of toDelete) {
  if (await deleteDoc('leads', l.$id)) {
    console.log(`  ✓ ${l.phone} | "${(l.notes || '').slice(0, 70)}"`);
    leadDel++;
  }
}

console.log(`\nDone. Leads: ${leadDel}, Conversations: ${convDel}, Customers: ${custDel} deleted.`);
console.log(`Real leads remaining: ${leads.length - leadDel}`);
