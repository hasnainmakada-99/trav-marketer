# TravAI Deploy Guide — 2026-07-05

## Prerequisites

- SSH key: `C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP\ssh-key-2026-05-06.key`
- Server: `ubuntu@161.118.174.116`
- App dir on server: `~/travai-app/travai-marketer`

## One-Command Deploy (PowerShell)

```powershell
ssh -i "C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP\ssh-key-2026-05-06.key" ubuntu@161.118.174.116 "cd ~/travai-app/travai-marketer && git pull origin main && npm run build && pm2 restart travai-app"
```

## Full Manual Deploy

### Step 1: Push local changes to GitHub

```powershell
cd travai-marketer
git add -A
git commit -m "description of your changes"
git push origin main
```

### Step 2: SSH into the Oracle server

```powershell
ssh -i "C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP\ssh-key-2026-05-06.key" ubuntu@161.118.174.116
```

### Step 3: Pull, build, restart

```bash
cd ~/travai-app/travai-marketer
git pull origin main
npm run build
pm2 restart travai-app
exit
```

## Verify

Check the app responds:

```powershell
curl.exe -k -s -o NUL -w "%{http_code}" "https://161-118-174-116.sslip.io/login"
```

Should return `200`.

## Rollback

If a deploy breaks the app:

```bash
ssh -i "C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP\ssh-key-2026-05-06.key" ubuntu@161.118.174.116
cd ~/travai-app/travai-marketer
git log --oneline -5          # see recent commits
git reset --hard <prev-hash>  # go back to last working commit
npm run build
pm2 restart travai-app
```

## Useful PM2 Commands

| Command | What it does |
|---------|-------------|
| `pm2 list` | Check if app is running |
| `pm2 logs travai-app --lines 20 --nostream` | See last 20 log lines |
| `pm2 restart travai-app` | Restart the app only |
| `pm2 logs travai-scheduler --lines 20 --nostream` | Check scheduler logs |
