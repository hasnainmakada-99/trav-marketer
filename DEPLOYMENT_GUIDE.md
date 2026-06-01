# TravAI Marketer — Deployment Guide

**Server:** Oracle Cloud VM — `161.118.174.116` (Mumbai, India West)
**App URL:** https://161-118-174-116.sslip.io
**SSH Key:** `ssh-key-2026-05-06.key` (in project root folder)

---

## How the Setup Works

```
Your Local Machine  →  GitHub (origin/main)  →  Oracle VM
     (edit files)        (git push)               (git fetch + build + restart)
```

The Oracle server does **not** auto-deploy. You always trigger it manually after pushing to GitHub.

---

## Step 1 — Edit Files Locally

Make your changes inside VS Code in this folder:

```
C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP\travai-marketer\
```

Key files you will commonly edit:

| File | What it controls |
|---|---|
| `lib/whatsapp-workflow.ts` | AI conversation flow, stages, replies |
| `app/api/whatsapp/webhook/route.ts` | WhatsApp message handling logic |
| `lib/openai.ts` | AI model, system prompts |
| `app/(platform)/dashboard/` | Dashboard pages (UI) |
| `app/api/` | All backend API routes |
| `bridge/scheduler.js` | Auto follow-up and campaign cron jobs |

---

## Step 2 — Push Changes to GitHub

Open PowerShell or Terminal, then navigate to the project root:

```powershell
cd "C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP"
```

### Option A — Push all changed files

```powershell
git add -A
git commit -m "describe what you changed"
git push origin main
```

### Option B — Push only one specific file

```powershell
git add travai-marketer/lib/whatsapp-workflow.ts
git commit -m "update workflow"
git push origin main
```

### Check what files you changed before pushing

```powershell
git status          # shows all modified files
git diff --stat     # shows exactly what changed
```

---

## Step 3 — Deploy to Oracle (Full Deploy)

After pushing to GitHub, run this command to deploy to Oracle:

```powershell
ssh -i "C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP\ssh-key-2026-05-06.key" ubuntu@161.118.174.116 "cd ~/travai-app/travai-marketer && git pull origin main && npm run build && pm2 restart travai-app && pm2 logs travai-app --lines 3 --nostream"
```

**What this does:**
1. Pulls all your new commits from GitHub
2. Rebuilds the Next.js app (~60 seconds)
3. Restarts the running server
4. Shows the last 3 log lines so you can confirm it started

**Expected output at the end:**
```
✓ Ready in 800ms
```

---

## Step 3B — Deploy Only Specific Files

Use this when Oracle is at an older commit and you only want to apply certain files without pulling everything else.

```powershell
ssh -i "C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP\ssh-key-2026-05-06.key" ubuntu@161.118.174.116 "cd ~/travai-app/travai-marketer && git fetch origin && git checkout origin/main -- lib/whatsapp-workflow.ts && git add -A && git commit -m 'deploy specific file' && npm run build && pm2 restart travai-app"
```

Replace `lib/whatsapp-workflow.ts` with whichever file(s) you changed (space-separated).

---

## PowerShell Shortcut — Save This for Daily Use

Add this function to your PowerShell profile so you can deploy with one word.

**Open your PowerShell profile:**
```powershell
notepad $PROFILE
```

**Paste this at the bottom and save:**
```powershell
function Deploy-Traventions {
    $key = "C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP\ssh-key-2026-05-06.key"
    ssh -i $key ubuntu@161.118.174.116 "cd ~/travai-app/travai-marketer && git pull origin main && npm run build && pm2 restart travai-app && pm2 logs travai-app --lines 3 --nostream"
}
```

**From now on, just run:**
```powershell
Deploy-Traventions
```

---

## Daily Workflow (Most Common)

```
1. Edit files in VS Code
2. git add -A
3. git commit -m "your message"
4. git push origin main
5. Deploy-Traventions   ← (after saving the shortcut above)
```

---

## Useful Oracle Commands

SSH into Oracle first:
```powershell
ssh -i "C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP\ssh-key-2026-05-06.key" ubuntu@161.118.174.116
```

Once inside Oracle:

| Task | Command |
|---|---|
| Check if app is running | `pm2 list` |
| See live logs | `pm2 logs travai-app` |
| See last 50 log lines | `pm2 logs travai-app --lines 50 --nostream` |
| Restart app only | `pm2 restart travai-app` |
| Check scheduler logs | `pm2 logs travai-scheduler --lines 20 --nostream` |
| See recent git commits | `cd ~/travai-app/travai-marketer && git log --oneline -10` |
| Check disk space | `df -h /` |
| Check memory | `free -h` |

---

## Rollback — If Something Breaks

If a deploy breaks the app, roll back to the last working commit:

**Step 1 — SSH into Oracle**
```powershell
ssh -i "C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP\ssh-key-2026-05-06.key" ubuntu@161.118.174.116
```

**Step 2 — See recent commits and find the good one**
```bash
cd ~/travai-app/travai-marketer
git log --oneline -10
```

**Step 3 — Reset to that commit**
```bash
git reset --hard COMMIT_HASH
```
Replace `COMMIT_HASH` with the 7-character hash from the log (e.g. `8004ac8`).

**Step 4 — Rebuild and restart**
```bash
npm run build && pm2 restart travai-app
```

---

## Two PM2 Processes Running

| Process | What it does |
|---|---|
| `travai-app` | The main Next.js web app (dashboard + WhatsApp AI) |
| `travai-scheduler` | Auto follow-up cron (10am) + campaign dispatch cron (6pm) |

Both restart automatically if the server reboots.

---

## GitHub Repository

```
https://github.com/hasnainmakada-99/trav-marketer
Branch: main
```

All deploys go through `main`. Never push directly to Oracle without pushing to GitHub first — they must stay in sync.

---

*Last updated: June 2026*
