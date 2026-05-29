/**
 * Debug script: fetch real conversation history and run resolveWorkflowState
 * Run: node --env-file=.env.local scripts/debug-workflow.mjs <phone> <message>
 * Example: node --env-file=.env.local scripts/debug-workflow.mjs 919638226174 "Arrange Callback"
 */
import { Client, Databases, Query } from 'node-appwrite';

const phone = process.argv[2] || '919638226174';
const userMessage = process.argv[3] || 'Arrange Callback';

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);
const db = new Databases(client);
const DB = process.env.APPWRITE_DATABASE_ID;
const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID;

// Find customer
const custRes = await db.listDocuments(DB, 'customers', [
  Query.equal('phone', phone), Query.limit(1),
]);
const customer = custRes.documents[0];
if (!customer) { console.error('Customer not found for', phone); process.exit(1); }

// Fetch conversations
const convRes = await db.listDocuments(DB, 'conversations', [
  Query.equal('teamId', TEAM_ID),
  Query.equal('customerId', customer.$id),
  Query.orderDesc('$createdAt'),
  Query.limit(40),
]);

const fullHistory = [...convRes.documents].reverse().map(c => ({
  role: c.role === 'user' ? 'user' : 'assistant',
  content: c.message || '[media]',
}));

// Remove current message from tail if already stored
const last = fullHistory[fullHistory.length - 1];
if (last?.role === 'user' && last.content?.toLowerCase() === userMessage.toLowerCase()) {
  fullHistory.pop();
}

const historyUserMessages = fullHistory
  .filter(h => h.role === 'user')
  .map(h => h.content);

console.log('\n=== HISTORY USER MESSAGES (last 10) ===');
historyUserMessages.slice(-10).forEach((m, i) => console.log(`  ${i+1}. "${m}"`));
console.log(`  Total user messages in window: ${historyUserMessages.length}`);

// Inline resolveWorkflowState logic to check slots
console.log('\n=== SIMULATING resolveWorkflowState ===');
console.log('  userMessage:', userMessage);

// Check greeting boundary
const greetingRx = /^(hi|hello|hey|hlo|helo|namaste|yo|good morning|good afternoon|good evening)$/i;
let lastGreetingIdx = -1;
for (let i = historyUserMessages.length - 1; i >= 0; i--) {
  if (greetingRx.test((historyUserMessages[i] || '').trim())) {
    lastGreetingIdx = i;
    break;
  }
}
console.log('  Last greeting index in history:', lastGreetingIdx, lastGreetingIdx >= 0 ? `("${historyUserMessages[lastGreetingIdx]}")` : '(none found)');

const sessionStart = lastGreetingIdx >= 0 ? lastGreetingIdx + 1 : 0;
const sessionMessages = historyUserMessages.slice(sessionStart);
console.log('\n=== SESSION MESSAGES ===');
sessionMessages.forEach((m, i) => console.log(`  ${i}. "${m}"`));

// Check for lead data in session messages
const emailRx = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const phoneRx = /\b(\+?\d[\d\s-]{7,14}\d)\b/;
const nameRx = /\b(?:name|full name|i am|i'm|my name is)\s*[:\-]?\s*([a-zA-Z .'-]{2,40})/i;

console.log('\n=== LEAD DATA FOUND IN SESSION ===');
sessionMessages.forEach((m, i) => {
  const hasEmail = emailRx.test(m);
  const hasPhone = phoneRx.test(m);
  const hasName = nameRx.test(m);
  const hasPpa = /\b(callback|arrange|itinerary|customize|customise|get detail|get package)\b/i.test(m);
  if (hasEmail || hasPhone || hasName || hasPpa) {
    console.log(`  [${i}] "${m}"`);
    if (hasEmail) console.log(`       → email: ${m.match(emailRx)?.[0]}`);
    if (hasPhone) console.log(`       → phone: ${m.match(phoneRx)?.[1]}`);
    if (hasName) console.log(`       → name: ${m.match(nameRx)?.[1]}`);
    if (hasPpa) console.log(`       → post_package_action detected`);
  }
});

// Check comma format (Sini, +91..., email)
const commaLeadRx = /^[a-zA-Z .'-]{2,40},\s*\+?\d[\d\s-]{7,14}\d,\s*[a-z0-9._%+-]+@/i;
console.log('\n=== COMMA-FORMAT LEAD IN SESSION ===');
sessionMessages.forEach((m, i) => {
  if (commaLeadRx.test(m.trim())) {
    console.log(`  [${i}] "${m}" ← LEAD FORMAT DETECTED`);
  }
});

// Check last 5 messages for lead data (the window we used before)
console.log('\n=== LAST 5 HISTORY MESSAGES FOR LEAD ===');
historyUserMessages.slice(-5).forEach((m, i) => {
  const hasEmail = emailRx.test(m);
  const hasPhone = phoneRx.test(m);
  const isCommaLead = commaLeadRx.test(m.trim());
  if (hasEmail || hasPhone || isCommaLead) {
    console.log(`  [-${5-i}] "${m}" ← HAS LEAD DATA`);
  } else {
    console.log(`  [-${5-i}] "${m}"`);
  }
});

console.log('\n=== CONCLUSION ===');
const leadInSession = sessionMessages.some(m => emailRx.test(m) || phoneRx.test(m) || commaLeadRx.test(m.trim()));
const leadInLast5 = historyUserMessages.slice(-5).some(m => emailRx.test(m) || phoneRx.test(m));
console.log('  Lead data in session messages:', leadInSession);
console.log('  Lead data in last 5 messages:', leadInLast5);
console.log('  → Expected stage after "Arrange Callback":', leadInSession || leadInLast5 ? 'WRONG: ask_callback (lead bleed!)' : 'CORRECT: collect_lead');
