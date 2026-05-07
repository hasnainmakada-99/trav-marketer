# WhatsApp Bridge Handoff Memory

Last updated: 2026-05-07

## 1) Current Goal and Product Behavior

This project runs a WhatsApp customer-support bot for Traventions with:

1. A persistent WhatsApp Web bridge (Baileys) running 24/7 on Oracle VM.
2. A Next.js app on Vercel (`trav-marketer.vercel.app`) as dashboard + AI brain.
3. Appwrite as conversation/customer memory.

Expected flow:

1. Customer sends WhatsApp message to linked business number.
2. Oracle bridge receives it and calls Next API (`/api/wa-bridge/incoming`).
3. Next decides whether AI should reply (handover-aware), builds response from DB + website knowledge, returns text.
4. Bridge sends the reply back on WhatsApp and records state/health via `/api/wa-bridge/state`.
5. Dashboard shows connection state, QR re-link status, conversations, and allows send/control actions.

## 2) Architecture Snapshot

### Runtime split

1. `travai-marketer` (Next.js):
   - Dashboard UI
   - AI prompt + travel knowledge assembly
   - Appwrite persistence
   - Bridge control/state APIs
2. `travai-marketer/bridge` (Node/Baileys):
   - Persistent WhatsApp session
   - Incoming/outgoing message relay
   - Control command polling (restart/relink/send)
   - QR status push

### Key bridge endpoints

1. `POST /api/wa-bridge/incoming`:
   - Input from bridge: incoming customer message or staff-outgoing marker.
   - Output: AI reply + flags (`shouldReply`, `quickMenu`, `quickMenuOptions`).
2. `POST/GET /api/wa-bridge/state`:
   - Bridge posts heartbeat/status/QR.
   - Dashboard reads latest status.
3. `GET/POST /api/wa-bridge/control`:
   - Dashboard queues commands.
   - Bridge polls and executes commands, then ACKs.

## 3) Important Business Rules Already Implemented

1. Human handover suppression:
   - If staff sends manual message (dashboard or WhatsApp app/web), AI suppresses replies for a configurable time window.
2. Auto-expiry:
   - Handover suppression expires after `WA_HUMAN_HANDOVER_MINUTES`.
3. Greeting behavior:
   - Greeting returns Traventions welcome + quick service menu.
4. Website + DB fallback:
   - AI uses Appwrite-derived knowledge first; if missing, routes user to best matching website page.
5. WhatsApp markdown normalization:
   - Responses are normalized to WhatsApp-compatible formatting.

## 4) Recent Commit History (Context)

Already on `main`:

1. `df243b2` - base WhatsApp bridge integration + dashboard controls.
2. `0a05a4c` - auto-expire human handover suppression.
3. `1e75232` - better package knowledge + website routing.
4. `42b850a` - multi-Appwrite DB knowledge read.
5. `35c7882` - support menu, typing indicator, manual handover capture.
6. `371bed3` - support menu fallback text cleanup.

Current working changes (not yet committed when this file was written):

1. Bridge quick menu switched to **interactive buttons** (not poll).
2. Incoming parser now supports button/list reply payloads.
3. API quick-menu mapping expanded to handle button IDs (`svc_1..svc_5`).

## 5) Files You Will Touch Most

1. Bridge runtime:
   - `bridge/server.js`
2. AI incoming route:
   - `app/api/wa-bridge/incoming/route.ts`
3. Bridge status API:
   - `app/api/wa-bridge/state/route.ts`
4. Bridge control API:
   - `app/api/wa-bridge/control/route.ts`
5. WhatsApp dashboard page:
   - `app/(platform)/dashboard/whatsapp/page.tsx`
6. Knowledge loader:
   - `lib/travel-knowledge.ts`
7. Formatting normalizer:
   - `lib/whatsapp-format.ts`

## 6) Env Configuration Map (No Secrets)

### Vercel (Next.js app)

1. `BRIDGE_SHARED_SECRET` (must match bridge `.env`)
2. `NEXT_PUBLIC_DEFAULT_TEAM_ID`
3. `OPENAI_API_KEY`
4. `TRAVENTIONS_WEBSITE_URL` (recommended: `https://traventions-ai.vercel.app`)
5. `WA_HUMAN_HANDOVER_MINUTES` (recommended: `15`)
6. Appwrite server vars:
   - `APPWRITE_ENDPOINT`
   - `APPWRITE_PROJECT_ID`
   - `APPWRITE_API_KEY`
   - `APPWRITE_DATABASE_ID` (primary app DB)
7. Optional Meta Cloud API vars can exist, but bridge mode should work even if Meta app/token is invalid.

### Oracle bridge (`bridge/.env`)

1. `BRIDGE_SHARED_SECRET` (same as Vercel)
2. `TEAM_ID` (same team used in dashboard)
3. `NEXT_APP_BASE_URL=https://trav-marketer.vercel.app`
4. Optional explicit overrides:
   - `NEXT_APP_BRIDGE_URL`
   - `NEXT_APP_BRIDGE_STATE_URL`
   - `NEXT_APP_BRIDGE_CONTROL_URL`

## 7) Oracle 24/7 Runbook

### SSH from Windows VS Code terminal

```powershell
ssh -i "C:\path\to\key" ubuntu@<ORACLE_PUBLIC_IP>
```

### PM2 control

```bash
pm2 list
pm2 logs travai-bridge --lines 120
pm2 restart travai-bridge
pm2 stop travai-bridge
pm2 start /home/ubuntu/travai-bridge/server.js --name travai-bridge
pm2 save
pm2 startup
```

### Deploy updated bridge code to Oracle

1. Replace `/home/ubuntu/travai-bridge/server.js` with latest repo version.
2. Ensure `/home/ubuntu/travai-bridge/.env` is correct.
3. Restart process:
   - `pm2 restart travai-bridge`
4. Validate:
   - `pm2 logs travai-bridge --lines 120`

## 8) Dashboard Operations Summary

Setup tab should support:

1. Live bridge status (`connected`, `qr_required`, `disconnected`, etc.).
2. QR display for relinking.
3. Restart bridge.
4. Force re-link (clear auth, generate new QR).

Send tab:

1. Sends messages via bridge command queue in bridge mode.

Templates tab:

1. In bridge mode, Meta template sync can be disconnected; this should not break text messaging.
2. Show graceful note instead of hard failure.

## 9) Current Known Limitations / Notes

1. WhatsApp interactive buttons in Web-automation libraries can vary by client/version.
2. Template cards/buttons shown in screenshots from Meta-managed flows are not identical to Baileys-level structures.
3. “Send buttons” APIs in the ecosystem are partially deprecated/unstable; plain text fallback is still required for reliability.
4. Bridge and Next app clocks/timezone differences can affect “recent handover” windows if system time drifts.

## 10) Troubleshooting Matrix

### A) No AI reply on WhatsApp

1. Check bridge connected:
   - `pm2 logs travai-bridge --lines 120`
2. Check bridge can call Vercel:
   - look for 200 on `/api/wa-bridge/incoming`.
3. Verify shared secret matches on both sides.
4. Check human handover suppression:
   - recent staff message may intentionally suppress AI.

### B) QR not visible in dashboard

1. Bridge must post to `/api/wa-bridge/state`.
2. Verify `BRIDGE_SHARED_SECRET` and `TEAM_ID`.
3. Check Appwrite collection for bridge state exists/has schema.
4. Use force re-link, then watch bridge logs for `qr_required`.

### C) Send Message from dashboard fails

1. Ensure bridge control polling is active.
2. Check `/api/wa-bridge/control` command queue + ACK logs.
3. Confirm recipient format is country-code + digits only.

### D) AI gives generic answers instead of package data

1. Verify Appwrite API key has read access to intended DBs.
2. Verify secondary DB ID (`696e96950008a6b5cddd`) is readable (read-only use).
3. Check `lib/travel-knowledge.ts` extraction logic and prompt assembly.
4. Ensure `OPENAI_API_KEY` exists in Vercel production env.

## 11) Safe Change Strategy for Next Contributor

1. Reproduce on localhost first (`npm run dev` + bridge running).
2. Validate with `npm run build` before deploy.
3. Deploy Next.js to Vercel.
4. Deploy `bridge/server.js` to Oracle and restart PM2.
5. End-to-end test:
   - greeting
   - button selection
   - package ask
   - manual handover suppression
   - dashboard outbound message

## 12) Quick Continuation Checklist

1. Pull latest `main`.
2. Confirm this branch includes button-mode commit.
3. Run local build.
4. Push + deploy Vercel.
5. Sync bridge to Oracle + restart PM2.
6. Test with two phones (customer and linked business account).

