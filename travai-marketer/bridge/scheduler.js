/**
 * TravAI Auto-Scheduler
 * Runs on Oracle VM via PM2 alongside the main Next.js app.
 *
 * Jobs:
 *   10:00 AM — Follow-up WhatsApp to inactive leads (no contact in 3+ days)
 *   18:00 PM — Dispatch campaigns whose scheduledAt has passed
 *
 * Usage: pm2 start bridge/scheduler.js --name travai-scheduler
 */

import dotenv from 'dotenv';
import { Client, Databases, Query } from 'node-appwrite';

dotenv.config();

const APP_URL = (process.env.NEXT_APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT || 'https://sfo.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID || '';
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || '';
const APPWRITE_DATABASE_ID = process.env.APPWRITE_DATABASE_ID || 'travai';
const TEAM_ID = process.env.TEAM_ID || process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';
const YCLOUD_API_KEY = (process.env.YCLOUD_API_KEY || '').trim();
const YCLOUD_FROM = (process.env.YCLOUD_WHATSAPP_FROM || '').trim();

if (!APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
  console.error('[Scheduler] Missing Appwrite credentials. Check .env');
  process.exit(1);
}

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const db = new Databases(client);

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

async function runFollowUpJob() {
  console.log('[Scheduler] Running follow-up job...');
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const result = await db.listDocuments(APPWRITE_DATABASE_ID, 'leads', [
      Query.equal('teamId', TEAM_ID),
      Query.notEqual('status', 'converted'),
      Query.notEqual('status', 'closed'),
      Query.lessThan('lastContactedAt', threeDaysAgo),
      Query.limit(50),
    ]);

    const leads = result.documents;
    console.log(`[Scheduler] Found ${leads.length} inactive leads to follow up`);

    let sent = 0;
    for (const lead of leads) {
      const name = lead.name ? ` ${lead.name.split(' ')[0]}` : '';
      const msg = `Hi${name}! 😊 This is Traventions — just checking in to see if you're still planning your trip.\n\nWe have some exciting travel deals right now. Reply to this message or type *1* to explore holiday packages.\n\n_Traventions — Your Travel Partner_ 🌍`;
      const ok = await sendWhatsApp(lead.phone, msg);
      if (ok) {
        sent++;
        await db.updateDocument(APPWRITE_DATABASE_ID, 'leads', lead.$id, {
          lastContactedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).catch(() => {});
      }
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[Scheduler] Follow-up job done. Sent: ${sent}/${leads.length}`);
  } catch (err) {
    console.error('[Scheduler] Follow-up job error:', err?.message);
  }
}

async function runCampaignDispatchJob() {
  console.log('[Scheduler] Running campaign dispatch job...');
  const now = new Date().toISOString();

  try {
    const result = await db.listDocuments(APPWRITE_DATABASE_ID, 'campaigns', [
      Query.equal('teamId', TEAM_ID),
      Query.equal('status', 'scheduled'),
      Query.lessThanEqual('scheduledAt', now),
      Query.limit(10),
    ]);

    const campaigns = result.documents;
    console.log(`[Scheduler] Found ${campaigns.length} campaigns to dispatch`);

    for (const campaign of campaigns) {
      console.log(`[Scheduler] Dispatching campaign: ${campaign.title} (${campaign.$id})`);
      try {
        const res = await fetch(`${APP_URL}/api/campaigns/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaignId: campaign.$id, teamId: TEAM_ID }),
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

function getHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

console.log('[Scheduler] Started. Checking every minute for scheduled jobs...');
console.log(`[Scheduler] Follow-up job: 10:00 daily | Campaign dispatch: 18:00 daily`);
console.log(`[Scheduler] Target: ${TEAM_ID} | App: ${APP_URL}`);

// Run immediately on startup to catch missed jobs (e.g. server was down)
runCampaignDispatchJob().catch(() => {});

setInterval(async () => {
  const hhmm = getHHMM();
  if (hhmm === '10:00') {
    await runFollowUpJob().catch(err => console.error('[Scheduler] Follow-up error:', err?.message));
  }
  if (hhmm === '18:00') {
    await runCampaignDispatchJob().catch(err => console.error('[Scheduler] Dispatch error:', err?.message));
  }
}, 60_000);

process.on('SIGINT', () => { console.log('[Scheduler] Stopping...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('[Scheduler] Stopping...'); process.exit(0); });
