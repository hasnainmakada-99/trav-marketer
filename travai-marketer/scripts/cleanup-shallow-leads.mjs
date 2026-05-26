/**
 * Deletes leads where the customer never replied after the bot's first response
 * (customer sent only 1 message total — spam/cold outreach, not a real lead).
 * Run on Oracle: node --env-file=.env scripts/cleanup-shallow-leads.mjs
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

const leads = await listAll('leads');
console.log(`Total leads: ${leads.length}`);

const toDelete = [];

for (const lead of leads) {
  if (!lead.phone) continue;

  // Count customer messages for this phone
  const customerMsgs = await db.listDocuments(DB_ID, 'conversations', [
    Query.equal('phone', lead.phone),
    Query.equal('sentBy', 'customer'),
    Query.limit(5),
  ]);

  const customerMsgCount = customerMsgs.total;

  // Keep if customer sent ≥ 2 messages (they actually engaged back)
  if (customerMsgCount >= 2) continue;

  toDelete.push({ lead, customerMsgCount });
}

console.log(`Leads with only 1 customer message (no real engagement): ${toDelete.length}`);

if (toDelete.length === 0) {
  console.log('Nothing to delete.');
  process.exit(0);
}

console.log('\nDeleting:');
let deleted = 0;
for (const { lead, customerMsgCount } of toDelete) {
  try {
    await db.deleteDocument(DB_ID, 'leads', lead.$id);
    console.log(`  ✓ ${lead.phone} | msgs:${customerMsgCount} | notes: "${(lead.notes || '').slice(0, 60)}"`);
    deleted++;
  } catch (err) {
    console.error(`  ✗ Failed ${lead.phone}: ${err.message}`);
  }
}

console.log(`\nDone. Deleted ${deleted} shallow leads. Real leads remaining: ${leads.length - deleted}`);
