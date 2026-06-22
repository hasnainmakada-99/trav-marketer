# TravAI Master Memory: PocketBase Migration + Production State

Use this file as the starting context for any new chat working on this project.

## Project

- Repo root: `C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP`
- Main app: `travai-marketer/`
- Production URL: `https://161-118-174-116.sslip.io`
- Oracle VM: `161.118.174.116`
- SSH key: `ssh-key-2026-05-06.key`
- PM2 app: `travai-app`
- PM2 scheduler: `travai-scheduler`
- PocketBase service: `travai-pocketbase`

## Why This Migration Happened

Appwrite Cloud on the GitHub Student / Education plan hit the database read limit repeatedly. The worst impact was:

- dashboard lead pages failing
- WhatsApp bot reads depending on Appwrite
- production instability when forcing fresh reads

The fix path chosen was:

1. keep Appwrite auth for now
2. self-host PocketBase on the Oracle forever-free VM
3. move hot operational collections to PocketBase first
4. keep the rest on Appwrite until quota resets and a safe import is possible

## Current Production State

### Live on Oracle right now

- PocketBase is installed and healthy at `http://127.0.0.1:8090`
- production app responds with `HTTP 200`
- PocketBase schema is installed
- PocketBase has imported cached CRM data
- production selectively uses PocketBase for hot CRM collections

### Current env routing on Oracle

These are the important live values in `~/travai-app/travai-marketer/.env`:

```env
APP_DATA_BACKEND=appwrite
APP_STORAGE_BACKEND=appwrite
POCKETBASE_MIRROR_WRITES=true
POCKETBASE_PRIMARY_COLLECTIONS=leads,customers,conversations
POCKETBASE_URL=http://127.0.0.1:8090
POCKETBASE_PUBLIC_URL=https://161-118-174-116.sslip.io
```

Meaning:

- Appwrite is still the global default backend
- PocketBase is the primary backend only for `leads`, `customers`, and `conversations`
- writes may still be mirrored to PocketBase where supported

## Collections: What Is Migrated vs Not Yet

### Already moved live to PocketBase

- `leads`
- `customers`
- `conversations`

### Seeded/imported into PocketBase from Oracle cache

- `leads`
- `customers`
- `conversations`

Verified counts on Oracle PocketBase SQLite:

- `leads: 36`
- `customers: 2`
- `conversations: 1034`

### Not fully migrated yet

- `business_configs`
- `staff`
- `campaigns`
- `campaign_logs`
- `gbp_posts`
- `gbp_reviews`
- `wa_local_templates`
- `gbp_media`
- `website_knowledge`

## Important Technical Decisions Already Made

### 1. Appwrite auth stays for now

Do not migrate auth casually. Passwords and sessions are the risky part. Data first, auth later.

### 2. PocketBase keeps its own internal IDs

Appwrite IDs are often longer than PocketBase record IDs allow. So the migration layer stores Appwrite IDs in an `appwriteId` field and exposes Appwrite-like `$id` behavior from the server layer.

### 3. Business config is not hard-cut yet

`business_configs` was not available in the Oracle cache import, so a full production cutover for that collection has not happened yet.

Instead:

- there is a fallback env-backed synthetic default `business_configs` record cached locally
- this keeps the bot from needing Appwrite just to find the default team config in common paths

### 4. The live lead API is already using PocketBase

Verified:

- `GET /api/leads?teamId=traventions-client-2026-gbp&limit=3`
- `GET /api/leads?teamId=traventions-client-2026-gbp&limit=3&refresh=1`

Both returned valid JSON after the selective cutover.

## Key Commits

Recent important commits:

- `f215500` Persist PocketBase collection cutover env
- `e08b32a` Route hot CRM collections to PocketBase
- `b4b4217` Map Appwrite ids into PocketBase records
- `b4baf95` Fix PocketBase bootstrap setup
- `c71ba2b` Add PocketBase backend and migration tooling
- `e4b1538` Prefer local CRM cache for dashboard and WhatsApp reads

## Files Added / Changed For Migration

Core files:

- `travai-marketer/lib/appwrite.ts`
- `travai-marketer/lib/data-backend.ts`
- `travai-marketer/lib/pocketbase-server.ts`
- `travai-marketer/pocketbase/schema.json`
- `travai-marketer/app/api/media/pb/[collectionId]/[recordId]/[filename]/route.ts`
- `travai-marketer/app/api/gbp/media/route.ts`
- `travai-marketer/app/api/wa-templates/local/route.ts`

Scripts:

- `travai-marketer/scripts/setup-pocketbase.mjs`
- `travai-marketer/scripts/migrate-local-cache-to-pocketbase.mjs`
- `travai-marketer/scripts/migrate-appwrite-to-pocketbase.mjs`
- `travai-marketer/scripts/install-pocketbase-oracle.sh`

Package scripts:

- `npm run setup-pocketbase`
- `npm run migrate-pocketbase:cache`
- `npm run migrate-pocketbase:appwrite`
- `npm run migrate-pocketbase:remaining`

## What Still Blocks Full Migration

Appwrite read quota is exhausted.

Error seen in production/logs:

- `limit_databases_reads_exceeded`

Because of that, a clean export/import of the remaining Appwrite-only collections could not be completed yet.

## Billing / Reset Assumption

The user stated the current Appwrite billing period is:

- `June 20, 2026` to `July 20, 2026`

Based on Appwrite docs, limits reset at the start of the next billing period. So the working assumption is:

- Appwrite reads should become available again around `July 20, 2026`

Still verify inside the Appwrite console `Usage` page before running the remaining import.

## Exact Next Step After Appwrite Reset

### 1. SSH into Oracle

```powershell
ssh -i "C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP\ssh-key-2026-05-06.key" ubuntu@161.118.174.116
```

### 2. Go to app directory

```bash
cd ~/travai-app/travai-marketer
```

### 3. Verify Appwrite reads are back

Run a small import or test call first. If the read limit error is gone, continue.

### 4. Import the remaining Appwrite collections into PocketBase

Use the prepared alias:

```bash
npm run migrate-pocketbase:remaining
```

That expands to:

```bash
node scripts/migrate-appwrite-to-pocketbase.mjs business_configs,staff,campaigns,campaign_logs,gbp_posts,gbp_reviews,wa_local_templates,gbp_media,website_knowledge
```

### 5. Validate imported counts

Check PocketBase data after the import.

### 6. Flip more collections to PocketBase gradually

Do not switch everything in one shot unless counts and runtime behavior are verified.

Suggested next cutover order:

1. `wa_local_templates`
2. `campaigns`
3. `campaign_logs`
4. `staff`
5. `gbp_posts`
6. `gbp_reviews`
7. `website_knowledge`
8. `business_configs`
9. `gbp_media`

Reason:

- `business_configs` and `gbp_media` are the most sensitive operationally
- do them after the simpler tables are proven stable

## How To Expand PocketBase Routing

Current live env:

```env
POCKETBASE_PRIMARY_COLLECTIONS=leads,customers,conversations
```

To move more collections, extend that env value, for example:

```env
POCKETBASE_PRIMARY_COLLECTIONS=leads,customers,conversations,wa_local_templates,campaigns,campaign_logs
```

Then rebuild and restart:

```bash
cd ~/travai-app/travai-marketer
git pull origin main
npm run build
pm2 restart travai-app --update-env
```

## PocketBase Verification Commands

### Service health

```bash
curl -fsS http://127.0.0.1:8090/api/health
systemctl is-active travai-pocketbase
```

### App env check

```bash
grep -E '^(APP_DATA_BACKEND|APP_STORAGE_BACKEND|POCKETBASE_MIRROR_WRITES|POCKETBASE_PRIMARY_COLLECTIONS|POCKETBASE_URL|POCKETBASE_PUBLIC_URL)=' ~/travai-app/travai-marketer/.env
```

### Production app health

```bash
curl -k -I -s https://161-118-174-116.sslip.io/ | head -n 5
```

### Lead API test

```bash
curl -k -i -s 'https://161-118-174-116.sslip.io/api/leads?teamId=traventions-client-2026-gbp&limit=3&refresh=1' | head -n 20
```

### Inspect PocketBase row counts via SQLite

```bash
python3 - <<'PY'
import sqlite3
conn = sqlite3.connect('/home/ubuntu/travai-pocketbase/pb_data/data.db')
cur = conn.cursor()
for table in ['leads', 'customers', 'conversations']:
    count = cur.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
    print(f'{table}:{count}')
PY
```

## Current Risks / Known Gaps

- Appwrite logs still contain historical `limit_databases_reads_exceeded` entries; do not confuse old log lines with current live routing
- `business_configs` is not fully imported from Appwrite yet
- `gbp_media` migration still needs careful validation because file storage behavior differs from plain document tables
- Appwrite auth is still in place
- there is an unrelated untracked file in local workspace:
  - `DELIVERY_GAP_AUDIT.md`

## If A New Chat Should Continue Immediately

Tell the new chat:

1. read this file first
2. inspect `travai-marketer/lib/appwrite.ts`, `lib/pocketbase-server.ts`, `lib/data-backend.ts`
3. confirm current Oracle env and PocketBase service health
4. do not break production auth
5. do not fully cut over `business_configs` without verifying imported data first
6. once Appwrite reads reset after the new billing period starts, run `npm run migrate-pocketbase:remaining` on Oracle and continue phased cutover

## Short Status Summary

The platform is no longer blocked on Appwrite for the hottest CRM traffic. PocketBase is live on Oracle, seeded, and already serving leads/customers/conversations in production. The remaining work is mainly a controlled import and cutover of the Appwrite-only collections once Appwrite read quota resets.
