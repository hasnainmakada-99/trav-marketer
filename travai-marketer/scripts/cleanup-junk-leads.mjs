/**
 * Deletes leads where the bot never sent a reply to that phone number.
 * Run on Oracle: node scripts/cleanup-junk-leads.mjs
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

// Get all phone numbers that have at least one bot reply
const botConvos = await listAll('conversations', [Query.equal('sentBy', 'ai')]);
const phonesWithBotReply = new Set(botConvos.map(c => c.phone).filter(Boolean));
console.log(`Phones with bot reply: ${phonesWithBotReply.size}`);

const junk = leads.filter(l => !phonesWithBotReply.has(l.phone));
console.log(`Junk leads to delete: ${junk.length}`);

if (junk.length === 0) {
  console.log('Nothing to delete.');
  process.exit(0);
}

console.log('\nDeleting:');
let deleted = 0;
for (const lead of junk) {
  try {
    await db.deleteDocument(DB_ID, 'leads', lead.$id);
    console.log(`  ✓ Deleted ${lead.phone} (${lead.$id})`);
    deleted++;
  } catch (err) {
    console.error(`  ✗ Failed ${lead.phone}: ${err.message}`);
  }
}

console.log(`\nDone. Deleted ${deleted}/${junk.length} junk leads.`);
