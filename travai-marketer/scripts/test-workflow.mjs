/**
 * Test resolveWorkflowState directly with the exact scenario that's failing.
 * Run: node scripts/test-workflow.mjs
 */

// We need to build first, then run against the TypeScript source via tsx or ts-node.
// This script uses the source directly.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Simulate what happens when user sends "Arrange Callback"
// after: Hello → Plan a Holiday → Thailand → exclusive' → 2 Adults, July, Bangalore, 5 Nights → 📞 *Arrange Callback* → Arrange Callback

// The historyUserMessages BEFORE the current "Arrange Callback" (after dedup pop)
const historyUserMessages = [
  // Old messages (before "Hi" at index 13)
  "Plan a Holiday",
  "Thailand",
  "Exclusive",
  "2 adults, july, bangalore, 5 nights",
  "Arrange callback",
  "Arrange Callback",
  "Hi", // old session greeting
  "Plan a Holiday",
  "Thailand",
  "exclusive",
  "2 Adults, July, Bangalore, 5 Nights",
  "Arrange Callback",
  "Arrange callback",
  // Current session (after latest "Hi" at index 13)
  "Hi",               // index 13 — session boundary
  "Plan a Holiday",   // index 14
  "Thailand",         // index 15
  "exclusive'",       // index 16
  "2 Adults, July, Bangalore, 5 Nights", // index 17
  "📞 *Arrange Callback*",               // index 18
  // Note: "Arrange Callback" (1:33 pm) was popped by dedup since it matches current message
];

console.log('historyUserMessages length:', historyUserMessages.length);
console.log('Last 8:', historyUserMessages.slice(-8));

// Manual simulation of resolveWorkflowState logic
const userMessage = "Arrange Callback";

// isGreetingLike
function isGreetingLike(msg) {
  return /^(hi|hello|hey|hlo|helo|namaste|yo|good morning|good afternoon|good evening)$/i.test(msg.trim());
}

// isDirectServiceSelection
function normalizeSelectionText(t) {
  return String(t||"").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();
}
function isDirectServiceSelection(message) {
  const text = normalizeSelectionText(message);
  if (/^(svc_1|svc_2|svc_3|1|2|3)$/.test(text)) return true;
  if (/^(plan a holiday|plan holiday|flights?|hotels?|visa|transfer|forex|insurance|mice|booking status)$/.test(text)) return true;
  if (/^(1|2|3)\s+(plan a holiday|plan holiday|flights?|hotels?)$/.test(text)) return true;
  return false;
}

// findSlotStartIndex
function findSlotStartIndex(historyMessages, intent) {
  let sessionStart = 0;
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    if (isGreetingLike(historyMessages[i])) {
      sessionStart = i + 1;
      break;
    }
  }
  console.log('  sessionStart:', sessionStart, '("' + historyMessages[sessionStart] + '")');

  for (let i = historyMessages.length - 1; i >= sessionStart; i--) {
    const msg = historyMessages[i];
    if (isDirectServiceSelection(msg)) {
      console.log('  Found direct selection at', i, ':', msg);
      return i;
    }
  }
  return sessionStart;
}

// detectPostPackageAction
function detectPostPackageAction(raw) {
  const text = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  if (/\b(callback|arrange)\b/.test(text) && (text.includes('arrange') || text.includes('callback'))) {
    return 'arrange_callback';
  }
  return null;
}

// Phone regex check
function extractPhone(raw) {
  const m = raw.match(/\b(\+?\d[\d\s-]{7,14}\d)\b/);
  return m ? m[1] : null;
}

// Email regex check
function extractEmail(text) {
  const m = text.match(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i);
  return m ? m[1] : null;
}

const LEAD_SLOT_KEYS = ['name', 'phone', 'email', 'callback_time'];

const slotStart = findSlotStartIndex(historyUserMessages, 'plan_holiday');
const sessionMessages = historyUserMessages.slice(slotStart);
console.log('\nSession messages:', sessionMessages);

let slots = {};
for (const item of sessionMessages) {
  const ppa = detectPostPackageAction(item);
  const phone = extractPhone(item);
  const email = extractEmail(item);

  // Strip lead slots (LEAD_SLOT_KEYS) — only keep travel slots
  if (ppa && !LEAD_SLOT_KEYS.includes('post_package_action')) {
    if (!slots.post_package_action) slots.post_package_action = ppa;
  }
  if (phone) console.log('  PHONE FOUND in session:', item, '->', phone);
  if (email) console.log('  EMAIL FOUND in session:', item, '->', email);
}

console.log('\nSlots from session (travel only, lead stripped):', slots);

// Find lastPpaIdx
let lastPpaIdx = -1;
for (let i = sessionMessages.length - 1; i >= 0; i--) {
  if (detectPostPackageAction(sessionMessages[i])) { lastPpaIdx = i; break; }
}
console.log('lastPpaIdx:', lastPpaIdx);

const afterAnchor = sessionMessages.slice(lastPpaIdx + 1);
console.log('afterAnchor:', afterAnchor);
const resetAfter = afterAnchor.some(m => isDirectServiceSelection(m) || isGreetingLike(m));
console.log('resetAfter:', resetAfter);

// Check afterAnchor for lead data
for (const item of afterAnchor) {
  const phone = extractPhone(item);
  const email = extractEmail(item);
  if (phone) console.log('  PHONE in afterAnchor:', phone);
  if (email) console.log('  EMAIL in afterAnchor:', email);
}

// Current message
const currPpa = detectPostPackageAction(userMessage);
const currPhone = extractPhone(userMessage);
const currEmail = extractEmail(userMessage);
console.log('\nCurrent message slots: ppa=', currPpa, 'phone=', currPhone, 'email=', currEmail);

const finalSlots = { ...slots };
if (currPpa) finalSlots.post_package_action = currPpa;
if (currPhone) finalSlots.phone = currPhone;
if (currEmail) finalSlots.email = currEmail;

console.log('\nFinal slots:', finalSlots);
console.log('hasFullLead:', Boolean(finalSlots.name && finalSlots.phone && finalSlots.email));
console.log('hasPostAction:', Boolean(finalSlots.post_package_action));
console.log('\n→ Expected stage:',
  !finalSlots.name && !finalSlots.phone && !finalSlots.email ? 'collect_lead' : 'ask_callback or confirmed'
);
