# Local WhatsApp-Web Bridge

This bridge keeps a persistent WhatsApp Web session on your laptop and forwards incoming messages to your local Next.js API for AI replies.

## 1) Configure local Next.js (.env.local)

In the main app (`travai-marketer/.env.local`) add:

- `BRIDGE_SHARED_SECRET=<same-secret-used-in-bridge-env>`

This is validated by:

- `POST /api/wa-bridge/incoming`

## 2) Configure Bridge

Inside this `bridge/` folder:

1. Copy `.env.example` to `.env`
2. Fill values:
   - `BRIDGE_SHARED_SECRET`
   - `NEXT_APP_BASE_URL` (recommended)
   - `NEXT_APP_BRIDGE_URL` (default: `http://localhost:3000/api/wa-bridge/incoming`)
   - `NEXT_APP_BRIDGE_STATE_URL` (default: `http://localhost:3000/api/wa-bridge/state`)
   - `NEXT_APP_BRIDGE_CONTROL_URL` (default: `http://localhost:3000/api/wa-bridge/control`)
   - `TEAM_ID` (your Appwrite tenant/team id)

If `NEXT_APP_BASE_URL` is set, the bridge auto-derives incoming/state/control URLs.

## 3) Run Locally

Terminal 1 (main app):

```bash
npm run dev
```

Terminal 2 (bridge):

```bash
cd bridge
npm install
npm start
```

Scan the QR shown in terminal from WhatsApp -> Linked Devices.

Keep this process running for replies to continue.

For Oracle deployment, use PM2 so the process stays alive 24/7 in background even after terminal closes.

## Notes

- This flow is separate from Meta Cloud API webhooks.
- Group chats are ignored in this starter version.
- Only text messages are handled in this starter version.
- For later deployment, change `NEXT_APP_BRIDGE_URL` to your Vercel URL and set `BRIDGE_SHARED_SECRET` in Vercel env.
- For production on Oracle, set `NEXT_APP_BASE_URL=https://trav-marketer.vercel.app`.
- Bridge status and QR relink state are posted to `/api/wa-bridge/state` for dashboard display.
- Bridge polls `/api/wa-bridge/control` so dashboard actions can restart bridge or force re-link without SSH commands.
