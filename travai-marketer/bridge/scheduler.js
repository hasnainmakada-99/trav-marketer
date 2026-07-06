/**
 * TravAI Auto-Scheduler
 * Runs on Oracle VM via PM2 alongside the main Next.js app.
 *
 * Jobs:
 *   10:00 AM — Follow-up WhatsApp to inactive leads (no contact in 3+ days)
 *   18:00 PM — Dispatch campaigns whose scheduledAt has passed
 *   09:00 AM (Monday) — Auto-publish weekly SEO-optimised GBP post
 *
 * Usage: pm2 start bridge/scheduler.js --name travai-scheduler
 */

const dotenv = require('dotenv');
const { Client, Databases, Query } = require('node-appwrite');
const PocketBase = require('pocketbase');

dotenv.config();

const APP_URL = (process.env.NEXT_APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT || 'https://sfo.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID || '';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || '';
const APPWRITE_DATABASE_ID = process.env.APPWRITE_DATABASE_ID || 'travai';
const APP_DATA_BACKEND = (process.env.APP_DATA_BACKEND || 'pocketbase').trim().toLowerCase();
const POCKETBASE_URL = (process.env.POCKETBASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
const POCKETBASE_SUPERUSER_EMAIL = (process.env.POCKETBASE_SUPERUSER_EMAIL || '').trim();
const POCKETBASE_SUPERUSER_PASSWORD = (process.env.POCKETBASE_SUPERUSER_PASSWORD || '').trim();
const TEAM_ID = process.env.TEAM_ID || process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';
const YCLOUD_API_KEY = (process.env.YCLOUD_API_KEY || '').trim();
const YCLOUD_FROM = (process.env.YCLOUD_WHATSAPP_FROM || '').trim();

if (APP_DATA_BACKEND !== 'pocketbase' && (!APPWRITE_PROJECT_ID || !APPWRITE_API_KEY)) {
  console.error('[Scheduler] Missing Appwrite credentials. Check .env');
  process.exit(1);
}

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const db = new Databases(client);
let pocketbaseAuthPromise = null;
let pocketbaseClient = null;

async function getPocketBaseClient() {
  if (pocketbaseClient?.authStore?.isValid) {
    return pocketbaseClient;
  }

  if (!POCKETBASE_SUPERUSER_EMAIL || !POCKETBASE_SUPERUSER_PASSWORD) {
    throw new Error('PocketBase credentials missing in scheduler environment');
  }

  if (!pocketbaseAuthPromise) {
    pocketbaseAuthPromise = (async () => {
      const pb = new PocketBase(POCKETBASE_URL);
      pb.autoCancellation(false);
      await pb.collection('_superusers').authWithPassword(
        POCKETBASE_SUPERUSER_EMAIL,
        POCKETBASE_SUPERUSER_PASSWORD
      );
      pocketbaseClient = pb;
      return pb;
    })().finally(() => {
      pocketbaseAuthPromise = null;
    });
  }

  return pocketbaseAuthPromise;
}

function escapeFilterValue(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

async function listLeadsForFollowup(threeDaysAgo) {
  if (APP_DATA_BACKEND === 'pocketbase') {
    const pb = await getPocketBaseClient();
    return await pb.collection('leads').getFullList({
      filter:
        `teamId = "${escapeFilterValue(TEAM_ID)}" && ` +
        `status != "converted" && status != "closed" && ` +
        `lastContactedAt < "${escapeFilterValue(threeDaysAgo)}"`,
      sort: '-createdAt',
    });
  }

  const result = await db.listDocuments(APPWRITE_DATABASE_ID, 'leads', [
    Query.equal('teamId', TEAM_ID),
    Query.notEqual('status', 'converted'),
    Query.notEqual('status', 'closed'),
    Query.lessThan('lastContactedAt', threeDaysAgo),
    Query.limit(50),
  ]);
  return result.documents;
}

async function touchLeadLastContact(leadId, nowIso) {
  if (APP_DATA_BACKEND === 'pocketbase') {
    const pb = await getPocketBaseClient();
    await pb.collection('leads').update(leadId, {
      lastContactedAt: nowIso,
      updatedAt: nowIso,
    });
    return;
  }

  await db.updateDocument(APPWRITE_DATABASE_ID, 'leads', leadId, {
    lastContactedAt: nowIso,
    updatedAt: nowIso,
  });
}

async function listScheduledCampaigns(nowIso) {
  if (APP_DATA_BACKEND === 'pocketbase') {
    const pb = await getPocketBaseClient();
    return await pb.collection('campaigns').getFullList({
      filter:
        `teamId = "${escapeFilterValue(TEAM_ID)}" && ` +
        `status = "scheduled" && scheduledAt <= "${escapeFilterValue(nowIso)}"`,
      sort: '+scheduledAt',
    });
  }

  const result = await db.listDocuments(APPWRITE_DATABASE_ID, 'campaigns', [
    Query.equal('teamId', TEAM_ID),
    Query.equal('status', 'scheduled'),
    Query.lessThanEqual('scheduledAt', nowIso),
    Query.limit(10),
  ]);
  return result.documents;
}

async function hasRecentCustomerMessage(phone) {
  const normalized = String(phone || '').replace(/[^\d]/g, '');
  if (!normalized) return false;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    if (APP_DATA_BACKEND === 'pocketbase') {
      const pb = await getPocketBaseClient();
      const result = await pb.collection('conversations').getList(1, 1, {
        filter: `phone = "${escapeFilterValue(normalized)}" && role = "user" && createdAt > "${escapeFilterValue(cutoff)}"`,
      });
      return result.totalItems > 0;
    }

    const result = await db.listDocuments(APPWRITE_DATABASE_ID, 'conversations', [
      Query.equal('phone', normalized),
      Query.equal('role', 'user'),
      Query.greaterThan('createdAt', cutoff),
      Query.limit(1),
    ]);
    return result.total > 0;
  } catch (err) {
    console.error(`[Scheduler] Error checking recent customer message for ${normalized}:`, err?.message);
    return false;
  }
}

function toE164(phone) {
  return `+${String(phone || '').replace(/[^\d]/g, '')}`;
}

async function sendWhatsApp(phone, message) {
  if (!YCLOUD_API_KEY || !YCLOUD_FROM) {
    console.warn('[Scheduler] YCloud not configured, skipping send to', phone);
    return false;
  }
  try {
    const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages/sendDirectly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
      body: JSON.stringify({
        from: toE164(YCLOUD_FROM),
        to: toE164(phone),
        type: 'text',
        text: { body: message },
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('[Scheduler] YCloud send failed for', phone, err?.message);
    return false;
  }
}

function getFollowUpStage(lastContactedAt) {
  const daysSinceContact = (Date.now() - new Date(lastContactedAt).getTime()) / (24 * 60 * 60 * 1000);
  if (daysSinceContact >= 14) return 3;
  if (daysSinceContact >= 7) return 2;
  return 1;
}

const FOLLOW_UP_MESSAGES = {
  1: (name) =>
    `Hi${name}! 😊 This is Traventions — just checking in to see if you're still planning your trip.\n\nWe have some exciting travel deals right now. Reply to this message or type *1* to explore holiday packages.\n\n_Traventions — Your Travel Partner_ 🌍`,
  2: (name) =>
    `Hi${name}! 👋 It's been a while since we last spoke.\n\nWe're running some *exclusive summer offers* and wanted to make sure you don't miss out! 🏖️✨\n\nReply *1* to see our best deals or *2* to speak with a travel expert.\n\n_Traventions — Your Travel Partner_ 🌍`,
  3: (name) =>
    `Hi${name}! This will be our last message — we don't want to bother you if the timing isn't right.\n\nIf you're still planning a trip, reply *1* now and we'll send you our best offers. Otherwise, you can always reach us anytime at Traventions. 🙏\n\n_Traventions — Your Travel Partner_ 🌍`,
};

async function runFollowUpJob() {
  console.log('[Scheduler] Running follow-up job...');
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const leads = (await listLeadsForFollowup(threeDaysAgo)).slice(0, 50);
    console.log(`[Scheduler] Found ${leads.length} inactive leads to follow up`);

    let sent = 0;
    let closed = 0;
    for (const lead of leads) {
      const lastContacted = lead.lastContactedAt || lead.createdAt || new Date().toISOString();
      const stage = getFollowUpStage(lastContacted);
      const name = lead.name ? ` ${lead.name.split(' ')[0]}` : '';
      const msg = FOLLOW_UP_MESSAGES[stage](name);
      const phone = lead.phone || lead.phoneNumber;

      if (!phone) {
        console.warn(`[Scheduler] Lead ${lead.id || lead.$id} has no phone, skipping`);
        continue;
      }

      const canSend = await hasRecentCustomerMessage(phone);
      if (!canSend) {
        console.log(`[Scheduler] Skipping follow-up to ${phone} — no recent inbound (would be paid)`);
        if (stage === 3) {
          const leadId = lead.id || lead.$id;
          try {
            if (APP_DATA_BACKEND === 'pocketbase') {
              const pb = await getPocketBaseClient();
              await pb.collection('leads').update(leadId, { status: 'closed', updatedAt: new Date().toISOString() });
            } else {
              await db.updateDocument(APPWRITE_DATABASE_ID, 'leads', leadId, { status: 'closed', updatedAt: new Date().toISOString() });
            }
            closed++;
            console.log(`[Scheduler] Auto-closed lead ${leadId} (paid skip, final stage)`);
          } catch (closeErr) {
            console.error(`[Scheduler] Failed to auto-close lead ${leadId}:`, closeErr?.message);
          }
        }
        continue;
      }

      const ok = await sendWhatsApp(phone, msg);
      if (ok) {
        sent++;
        const leadId = lead.id || lead.$id;
        await touchLeadLastContact(leadId, new Date().toISOString()).catch(() => {});

        // Stage 3: auto-close lead after final follow-up
        if (stage === 3) {
          try {
            if (APP_DATA_BACKEND === 'pocketbase') {
              const pb = await getPocketBaseClient();
              await pb.collection('leads').update(leadId, {
                status: 'closed',
                updatedAt: new Date().toISOString(),
              });
            } else {
              await db.updateDocument(APPWRITE_DATABASE_ID, 'leads', leadId, {
                status: 'closed',
                updatedAt: new Date().toISOString(),
              });
            }
            closed++;
            console.log(`[Scheduler] Auto-closed lead ${leadId} after final follow-up`);
          } catch (closeErr) {
            console.error(`[Scheduler] Failed to auto-close lead ${leadId}:`, closeErr?.message);
          }
        }
      }
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[Scheduler] Follow-up job done. Sent: ${sent}/${leads.length}, Auto-closed: ${closed}`);
  } catch (err) {
    console.error('[Scheduler] Follow-up job error:', err?.message);
  }
}

async function runCampaignDispatchJob() {
  console.log('[Scheduler] Running campaign dispatch job...');
  const now = new Date().toISOString();

  try {
    const campaigns = (await listScheduledCampaigns(now)).slice(0, 10);
    console.log(`[Scheduler] Found ${campaigns.length} campaigns to dispatch`);

    for (const campaign of campaigns) {
      const campaignId = campaign.appwriteId || campaign.$id || campaign.id;
      console.log(`[Scheduler] Dispatching campaign: ${campaign.title} (${campaignId})`);
      try {
        const res = await fetch(`${APP_URL}/api/campaigns/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaignId, teamId: TEAM_ID }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          console.log(`[Scheduler] Campaign dispatched: ${campaign.title}, sent to ${data.totalSent || 0}`);
        } else {
          console.error(`[Scheduler] Campaign dispatch failed: ${campaign.title}`, data?.error);
        }
      } catch (err) {
        console.error(`[Scheduler] Campaign dispatch error: ${campaign.title}`, err?.message);
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('[Scheduler] Campaign dispatch job done.');
  } catch (err) {
    console.error('[Scheduler] Campaign dispatch job error:', err?.message);
  }
}

async function listConvertedLeadsForReview() {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  if (APP_DATA_BACKEND === 'pocketbase') {
    const pb = await getPocketBaseClient();
    return await pb.collection('leads').getFullList({
      filter:
        `teamId = "${escapeFilterValue(TEAM_ID)}" && ` +
        `status = "converted" && ` +
        `(reviewRequestSentAt = null || reviewRequestSentAt = "") && ` +
        `updatedAt >= "${escapeFilterValue(sevenDaysAgo)}" && ` +
        `updatedAt <= "${escapeFilterValue(twoDaysAgo)}"`,
      sort: '-updatedAt',
    });
  }

  const result = await db.listDocuments(APPWRITE_DATABASE_ID, 'leads', [
    Query.equal('teamId', TEAM_ID),
    Query.equal('status', 'converted'),
    Query.isNull('reviewRequestSentAt'),
    Query.lessThanEqual('updatedAt', twoDaysAgo),
    Query.greaterThanEqual('updatedAt', sevenDaysAgo),
    Query.limit(50),
  ]);
  return result.documents;
}

async function runReviewRequestJob() {
  console.log('[Scheduler] Running review request job...');
  const reviewLink = process.env.GOOGLE_REVIEW_LINK || 'https://www.google.com/search?q=Traventions+India+Pvt+Ltd+Reviews';

  try {
    const leads = (await listConvertedLeadsForReview()).slice(0, 30);
    console.log(`[Scheduler] Found ${leads.length} converted leads to request reviews from`);

    let sent = 0;
    for (const lead of leads) {
      const name = lead.name ? ` ${lead.name.split(' ')[0]}` : '';
      const phone = lead.phone || lead.phoneNumber;
      if (!phone) continue;

      const msg = `Hi${name}! 🙏 We hope you had a great experience with Traventions.\n\nCould you take a moment to share your feedback? Your review helps us serve you and others better! ⭐⭐⭐⭐⭐\n\n${reviewLink}\n\nThank you for choosing us! ❤️\n_Traventions — Your Travel Partner_`;

      const canSend = await hasRecentCustomerMessage(phone);
      if (!canSend) {
        console.log(`[Scheduler] Skipping review request to ${phone} — no recent inbound (would be paid)`);
        continue;
      }

      const ok = await sendWhatsApp(phone, msg);
      if (ok) {
        sent++;
        const leadId = lead.id || lead.$id;
        try {
          if (APP_DATA_BACKEND === 'pocketbase') {
            const pb = await getPocketBaseClient();
            await pb.collection('leads').update(leadId, {
              reviewRequestSentAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          } else {
            await db.updateDocument(APPWRITE_DATABASE_ID, 'leads', leadId, {
              reviewRequestSentAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (updateErr) {
          console.error(`[Scheduler] Failed to mark review request sent for lead ${leadId}:`, updateErr?.message);
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[Scheduler] Review request job done. Sent: ${sent}/${leads.length}`);
  } catch (err) {
    console.error('[Scheduler] Review request job error:', err?.message);
  }
}

function getHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

async function listGbpConnectedTeams() {
  if (APP_DATA_BACKEND === 'pocketbase') {
    const pb = await getPocketBaseClient();
    return await pb.collection('business_configs').getFullList({
      filter:
        `googleLocationId != "" && googleAccessToken != "" && ` +
        `googleLocationId != null && googleAccessToken != null`,
      sort: '-createdAt',
    });
  }

  const result = await db.listDocuments(APPWRITE_DATABASE_ID, 'business_configs', [
    Query.notEqual('googleLocationId', ''),
    Query.notEqual('googleAccessToken', ''),
    Query.isNotNull('googleLocationId'),
    Query.isNotNull('googleAccessToken'),
    Query.limit(20),
  ]);
  return result.documents;
}

async function runWeeklyGbpPostJob() {
  console.log('[Scheduler] Running weekly GBP post job...');
  try {
    const teams = (await listGbpConnectedTeams()).slice(0, 10);
    console.log(`[Scheduler] Found ${teams.length} teams with active GBP connections`);

    let posted = 0;
    for (const team of teams) {
      const teamId = team.teamId || team.id || team.$id;
      const businessName = team.businessName || 'Business';
      console.log(`[Scheduler] Generating weekly post for ${businessName} (${teamId})`);

      try {
        const res = await fetch(`${APP_URL}/api/gbp/posts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teamId,
            createdBy: 'scheduler',
            autoGenerate: true,
            publishNow: true,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          posted++;
          console.log(`[Scheduler] GBP post published for ${businessName}: "${data?.title || 'ok'}"`);
        } else {
          console.error(`[Scheduler] GBP post failed for ${businessName}:`, data?.error || res.statusText);
        }
      } catch (err) {
        console.error(`[Scheduler] GBP post error for ${businessName}:`, err?.message);
      }

      await new Promise(r => setTimeout(r, 3000));
    }

    console.log(`[Scheduler] Weekly GBP post job done. Published: ${posted}/${teams.length}`);
  } catch (err) {
    console.error('[Scheduler] Weekly GBP post job error:', err?.message);
  }
}

async function listPendingTransactions(sinceDate, untilDate) {
  if (APP_DATA_BACKEND === 'pocketbase') {
    const pb = await getPocketBaseClient();
    return await pb.collection('transactions').getFullList({
      filter:
        `status = "pending" && ` +
        `createdAt >= "${escapeFilterValue(sinceDate)}" && ` +
        `createdAt <= "${escapeFilterValue(untilDate)}"`,
      sort: '-createdAt',
    });
  }
  const result = await db.listDocuments(APPWRITE_DATABASE_ID, 'transactions', [
    Query.equal('status', 'pending'),
    Query.greaterThanEqual('createdAt', sinceDate),
    Query.lessThanEqual('createdAt', untilDate),
    Query.limit(100),
  ]);
  return result.documents;
}

async function lookupCustomerName(customerId, phone) {
  try {
    if (APP_DATA_BACKEND === 'pocketbase') {
      const pb = await getPocketBaseClient();
      if (customerId) {
        try {
          const cust = await pb.collection('customers').getOne(customerId);
          if (cust?.name) return cust.name;
        } catch {}
      }
      if (phone) {
        const normalized = String(phone).replace(/[^\d]/g, '');
        const result = await pb.collection('customers').getFullList({
          filter: `phone = "${escapeFilterValue(normalized)}"`,
          limit: 1,
        });
        if (result.length > 0 && result[0].name) return result[0].name;
      }
      return null;
    }
    if (customerId) {
      try {
        const cust = await db.getDocument(APPWRITE_DATABASE_ID, 'customers', customerId);
        if (cust?.name) return cust.name;
      } catch {}
    }
    if (phone) {
      const normalized = String(phone).replace(/[^\d]/g, '');
      const result = await db.listDocuments(APPWRITE_DATABASE_ID, 'customers', [
        Query.equal('phone', normalized),
        Query.limit(1),
      ]);
      if (result.documents.length > 0 && result.documents[0].name) return result.documents[0].name;
    }
    return null;
  } catch {
    return null;
  }
}

async function runPaymentReminderJob() {
  console.log('[Scheduler] Running payment reminder job...');
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const txs = (await listPendingTransactions(twoDaysAgo, sevenDaysAgo)).slice(0, 50);
    console.log(`[Scheduler] Found ${txs.length} pending transactions for reminder`);
    let sent = 0;
    for (const tx of txs) {
      const phone = tx.phone || tx.customerPhone;
      const customerId = tx.customerId;
      if (!phone) {
        console.warn(`[Scheduler] Transaction ${tx.id || tx.$id} has no phone, skipping`);
        continue;
      }
      const name = await lookupCustomerName(customerId, phone) || 'there';
      const amount = tx.amount || tx.total || '—';
      const service = tx.service || tx.serviceName || 'service';
      const msg = `Hi ${name}! 💳 Quick reminder — your payment of ₹${amount} for ${service} is still pending.\n\nPlease complete it at your earliest convenience so we can confirm your booking.\n\nReply *1* to pay now or *2* to speak with us.\n\n_Traventions — Your Travel Partner_`;
      const canSend = await hasRecentCustomerMessage(phone);
      if (!canSend) {
        console.log(`[Scheduler] Skipping payment reminder to ${phone} — no recent inbound (would be paid)`);
        continue;
      }
      const ok = await sendWhatsApp(phone, msg);
      if (ok) {
        sent++;
        const txId = tx.id || tx.$id;
        try {
          if (APP_DATA_BACKEND === 'pocketbase') {
            const pb = await getPocketBaseClient();
            await pb.collection('transactions').update(txId, { reminderSentAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          } else {
            await db.updateDocument(APPWRITE_DATABASE_ID, 'transactions', txId, { reminderSentAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          }
        } catch (updateErr) {
          console.error(`[Scheduler] Failed to mark reminder sent for transaction ${txId}:`, updateErr?.message);
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[Scheduler] Payment reminder job done. Sent: ${sent}/${txs.length}`);
  } catch (err) {
    console.error('[Scheduler] Payment reminder job error:', err?.message);
  }
}

async function listRenewableTransactions(keywords, monthlyFrom, monthlyTo, annualFrom, annualTo) {
  if (APP_DATA_BACKEND === 'pocketbase') {
    const pb = await getPocketBaseClient();
    const svcFilter = keywords.map(k => `service ~ "${escapeFilterValue(k)}"`).join(' || ');
    const dateFilter = `((date >= "${escapeFilterValue(monthlyFrom)}" && date <= "${escapeFilterValue(monthlyTo)}") || (date >= "${escapeFilterValue(annualFrom)}" && date <= "${escapeFilterValue(annualTo)}"))`;
    return await pb.collection('transactions').getFullList({
      filter: `(${svcFilter}) && ${dateFilter}`,
      sort: '-date',
    });
  }
  const result = await db.listDocuments(APPWRITE_DATABASE_ID, 'transactions', [
    Query.limit(200),
  ]);
  return result.documents.filter(d => {
    const svc = (d.service || '').toLowerCase();
    const matchesKeyword = keywords.some(k => svc.includes(k));
    if (!matchesKeyword) return false;
    const dDate = new Date(d.date || d.createdAt).getTime();
    return (dDate >= new Date(monthlyFrom).getTime() && dDate <= new Date(monthlyTo).getTime()) ||
           (dDate >= new Date(annualFrom).getTime() && dDate <= new Date(annualTo).getTime());
  });
}

async function listRenewableLeads(keywords, monthlyFrom, monthlyTo, annualFrom, annualTo) {
  if (APP_DATA_BACKEND === 'pocketbase') {
    const pb = await getPocketBaseClient();
    const notesFilter = keywords.map(k => `notes ~ "${escapeFilterValue(k)}"`).join(' || ');
    const dateFilter = `((lastContactedAt >= "${escapeFilterValue(monthlyFrom)}" && lastContactedAt <= "${escapeFilterValue(monthlyTo)}") || (lastContactedAt >= "${escapeFilterValue(annualFrom)}" && lastContactedAt <= "${escapeFilterValue(annualTo)}"))`;
    return await pb.collection('leads').getFullList({
      filter: `(${notesFilter}) && ${dateFilter}`,
      sort: '-lastContactedAt',
    });
  }
  const result = await db.listDocuments(APPWRITE_DATABASE_ID, 'leads', [
    Query.limit(200),
  ]);
  return result.documents.filter(d => {
    const notes = (d.notes || '').toLowerCase();
    const matchesKeyword = keywords.some(k => notes.includes(k));
    if (!matchesKeyword) return false;
    const dDate = new Date(d.lastContactedAt || d.createdAt).getTime();
    return (dDate >= new Date(monthlyFrom).getTime() && dDate <= new Date(monthlyTo).getTime()) ||
           (dDate >= new Date(annualFrom).getTime() && dDate <= new Date(annualTo).getTime());
  });
}

async function runRenewalReminderJob() {
  console.log('[Scheduler] Running renewal reminder job...');
  const now = Date.now();
  const monthlyFrom = new Date(now - 35 * 24 * 60 * 60 * 1000).toISOString();
  const monthlyTo = new Date(now - 25 * 24 * 60 * 60 * 1000).toISOString();
  const annualFrom = new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString();
  const annualTo = new Date(now - 340 * 24 * 60 * 60 * 1000).toISOString();
  const keywords = ['membership', 'subscription', 'retainer', 'annual', 'yearly', 'monthly'];
  try {
    const txs = await listRenewableTransactions(keywords, monthlyFrom, monthlyTo, annualFrom, annualTo);
    const leadDocs = await listRenewableLeads(keywords, monthlyFrom, monthlyTo, annualFrom, annualTo);
    const items = [...txs, ...leadDocs];
    console.log(`[Scheduler] Found ${items.length} renewable items for reminder`);
    let sent = 0;
    for (const item of items) {
      const phone = item.phone || item.customerPhone || item.phoneNumber;
      if (!phone) {
        console.warn(`[Scheduler] Renewal item ${item.id || item.$id} has no phone, skipping`);
        continue;
      }
      const itemName = item.name ? item.name.split(' ')[0] : null;
      const name = itemName || await lookupCustomerName(item.customerId, phone) || 'there';
      const service = item.service || item.serviceName || 'subscription';
      const msg = `Hi ${name}! 🔄 Your ${service} is due for renewal!\n\nKeep enjoying uninterrupted benefits. Reply *1* to renew now or *2* to talk to us.\n\n_Traventions — Your Travel Partner_`;
      const canSend = await hasRecentCustomerMessage(phone);
      if (!canSend) {
        console.log(`[Scheduler] Skipping renewal reminder to ${phone} — no recent inbound (would be paid)`);
        continue;
      }
      const ok = await sendWhatsApp(phone, msg);
      if (ok) sent++;
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[Scheduler] Renewal reminder job done. Sent: ${sent}/${items.length}`);
  } catch (err) {
    console.error('[Scheduler] Renewal reminder job error:', err?.message);
  }
}

function getRecommendedService(previousService) {
  const svc = (previousService || '').toLowerCase();
  if (svc.includes('holiday') || svc.includes('package')) return 'Flight Booking';
  if (svc.includes('flight') || svc.includes('air') || svc.includes('plane')) return 'Hotel Booking';
  if (svc.includes('hotel') || svc.includes('stay') || svc.includes('accommodation')) return 'Holiday Package';
  return 'Premium Holiday Package';
}

async function listCompletedTransactions(sinceDate) {
  if (APP_DATA_BACKEND === 'pocketbase') {
    const pb = await getPocketBaseClient();
    return await pb.collection('transactions').getFullList({
      filter: `status = "completed" && date >= "${escapeFilterValue(sinceDate)}"`,
      sort: '-date',
    });
  }
  const result = await db.listDocuments(APPWRITE_DATABASE_ID, 'transactions', [
    Query.equal('status', 'completed'),
    Query.greaterThanEqual('date', sinceDate),
    Query.limit(200),
  ]);
  return result.documents;
}

async function runUpsellJob() {
  console.log('[Scheduler] Running upsell job...');
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const txs = await listCompletedTransactions(ninetyDaysAgo);
    const groups = {};
    for (const tx of txs) {
      const key = tx.customerId || tx.phone || tx.customerPhone;
      if (!key) continue;
      if (!groups[key]) groups[key] = { items: [], phone: tx.phone || tx.customerPhone, customerId: tx.customerId, name: tx.name || null };
      groups[key].items.push(tx);
    }
    const candidates = Object.values(groups).filter(g => g.items.length >= 1 && g.items.length <= 2);
    console.log(`[Scheduler] Found ${candidates.length} upsell candidates (${txs.length} total completed txs)`);
    let sent = 0;
    for (const candidate of candidates) {
      const phone = candidate.phone;
      if (!phone) continue;
      const lastTx = candidate.items[candidate.items.length - 1];
      const name = candidate.name || await lookupCustomerName(candidate.customerId, phone) || 'there';
      const previousService = lastTx.service || lastTx.serviceName || 'service';
      const recommendedService = getRecommendedService(previousService);
      const msg = `Hi ${name}! 🎉 As a valued Traventions customer, we have an exclusive offer for you!\n\nYou loved ${previousService} — now try our ${recommendedService} at a special discount!\n\nReply *1* to learn more or *2* to call us.\n\n_Traventions — Your Travel Partner_`;
      const canSend = await hasRecentCustomerMessage(phone);
      if (!canSend) {
        console.log(`[Scheduler] Skipping upsell to ${phone} — no recent inbound (would be paid)`);
        continue;
      }
      const ok = await sendWhatsApp(phone, msg);
      if (ok) sent++;
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[Scheduler] Upsell job done. Sent: ${sent}/${candidates.length}`);
  } catch (err) {
    console.error('[Scheduler] Upsell job error:', err?.message);
  }
}

function isMonday() {
  return new Date().getDay() === 1;
}

console.log('[Scheduler] Started. Checking every minute for scheduled jobs...');
console.log(`[Scheduler] Follow-up: 10:00 | Review: 11:00 | Payment reminder: 12:00 | Renewal: 13:00 | Upsell: 14:00 | Campaign: 18:00 | GBP post: 09:00 Mon`);
console.log(`[Scheduler] Target: ${TEAM_ID} | App: ${APP_URL}`);

// Run immediately on startup to catch missed jobs (e.g. server was down)
runCampaignDispatchJob().catch(() => {});

setInterval(async () => {
  const hhmm = getHHMM();
  if (hhmm === '10:00') {
    await runFollowUpJob().catch(err => console.error('[Scheduler] Follow-up error:', err?.message));
  }
  if (hhmm === '11:00') {
    await runReviewRequestJob().catch(err => console.error('[Scheduler] Review request error:', err?.message));
  }
  if (hhmm === '12:00') {
    await runPaymentReminderJob().catch(err => console.error('[Scheduler] Payment reminder error:', err?.message));
  }
  if (hhmm === '13:00') {
    await runRenewalReminderJob().catch(err => console.error('[Scheduler] Renewal reminder error:', err?.message));
  }
  if (hhmm === '14:00') {
    await runUpsellJob().catch(err => console.error('[Scheduler] Upsell error:', err?.message));
  }
  if (hhmm === '18:00') {
    await runCampaignDispatchJob().catch(err => console.error('[Scheduler] Dispatch error:', err?.message));
  }
  if (hhmm === '09:00' && isMonday()) {
    await runWeeklyGbpPostJob().catch(err => console.error('[Scheduler] GBP post error:', err?.message));
  }
}, 60_000);

process.on('SIGINT', () => { console.log('[Scheduler] Stopping...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('[Scheduler] Stopping...'); process.exit(0); });

module.exports = {
  runFollowUpJob,
  runCampaignDispatchJob,
  runReviewRequestJob,
  runWeeklyGbpPostJob,
  runPaymentReminderJob,
  runRenewalReminderJob,
  runUpsellJob,
};
