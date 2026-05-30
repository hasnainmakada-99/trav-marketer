#!/bin/bash
# Oracle VM deploy script — run from /home/ubuntu/trav-marketer
set -euo pipefail

APP_DIR="/home/ubuntu/travai-app"
NEXT_DIR="$APP_DIR/travai-marketer"

echo "==> Pulling latest code..."
cd "$APP_DIR"
git pull origin main

echo "==> Installing dependencies..."
cd "$NEXT_DIR"
npm ci --include=dev

echo "==> Building Next.js..."
npm run build

echo "==> Restarting PM2 apps..."
cd "$APP_DIR"
pm2 startOrRestart travai-marketer/ecosystem.config.cjs --env production
pm2 save

echo "==> Done! Status:"
pm2 list
