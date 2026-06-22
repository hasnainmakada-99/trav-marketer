#!/usr/bin/env bash
set -euo pipefail

PB_VERSION="${PB_VERSION:-0.39.4}"
PB_DIR="${PB_DIR:-/home/ubuntu/travai-pocketbase}"
APP_DIR="${APP_DIR:-/home/ubuntu/travai-app/travai-marketer}"
PB_HTTP="${PB_HTTP:-127.0.0.1:8090}"
APP_ENV_FILE="${APP_ENV_FILE:-$APP_DIR/.env}"
PB_ENV_FILE="${PB_ENV_FILE:-$PB_DIR/superuser.env}"
PB_EMAIL="${POCKETBASE_SUPERUSER_EMAIL:-admin@traventions.local}"
PB_PASSWORD="${POCKETBASE_SUPERUSER_PASSWORD:-}"
APP_PUBLIC_URL="${NEXT_PUBLIC_APP_URL:-https://161-118-174-116.sslip.io}"

if [[ -f "$APP_ENV_FILE" ]]; then
  EXISTING_PUBLIC_URL="$(grep -E '^NEXT_PUBLIC_APP_URL=' "$APP_ENV_FILE" | tail -n 1 | cut -d '=' -f2- || true)"
  if [[ -n "$EXISTING_PUBLIC_URL" ]]; then
    APP_PUBLIC_URL="$EXISTING_PUBLIC_URL"
  fi
fi

if [[ -z "$PB_PASSWORD" ]]; then
  PB_PASSWORD="$(openssl rand -base64 30 | tr -d '\n' | tr '/+' 'AB')"
fi

mkdir -p "$PB_DIR"
cd "$PB_DIR"

if ! command -v unzip >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y unzip
fi

if [[ ! -f "$PB_DIR/pocketbase" ]]; then
  curl -L "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -o pocketbase.zip
  unzip -o pocketbase.zip
  chmod +x pocketbase
fi

cat > "$PB_ENV_FILE" <<EOF
POCKETBASE_URL=http://127.0.0.1:8090
POCKETBASE_PUBLIC_URL=$APP_PUBLIC_URL
POCKETBASE_SUPERUSER_EMAIL=$PB_EMAIL
POCKETBASE_SUPERUSER_PASSWORD=$PB_PASSWORD
EOF
chmod 600 "$PB_ENV_FILE"

grep -q '^POCKETBASE_URL=' "$APP_ENV_FILE" || echo "POCKETBASE_URL=http://127.0.0.1:8090" >> "$APP_ENV_FILE"
grep -q '^POCKETBASE_PUBLIC_URL=' "$APP_ENV_FILE" || echo "POCKETBASE_PUBLIC_URL=$APP_PUBLIC_URL" >> "$APP_ENV_FILE"
grep -q '^POCKETBASE_SUPERUSER_EMAIL=' "$APP_ENV_FILE" || echo "POCKETBASE_SUPERUSER_EMAIL=$PB_EMAIL" >> "$APP_ENV_FILE"
grep -q '^POCKETBASE_SUPERUSER_PASSWORD=' "$APP_ENV_FILE" || echo "POCKETBASE_SUPERUSER_PASSWORD=$PB_PASSWORD" >> "$APP_ENV_FILE"
grep -q '^APP_DATA_BACKEND=' "$APP_ENV_FILE" || echo "APP_DATA_BACKEND=appwrite" >> "$APP_ENV_FILE"
grep -q '^APP_STORAGE_BACKEND=' "$APP_ENV_FILE" || echo "APP_STORAGE_BACKEND=appwrite" >> "$APP_ENV_FILE"
grep -q '^POCKETBASE_MIRROR_WRITES=' "$APP_ENV_FILE" || echo "POCKETBASE_MIRROR_WRITES=true" >> "$APP_ENV_FILE"
grep -q '^POCKETBASE_PRIMARY_COLLECTIONS=' "$APP_ENV_FILE" || echo "POCKETBASE_PRIMARY_COLLECTIONS=leads,customers,conversations" >> "$APP_ENV_FILE"

sudo tee /etc/systemd/system/travai-pocketbase.service >/dev/null <<EOF
[Unit]
Description=Traventions PocketBase
After=network.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=$PB_DIR
ExecStart=$PB_DIR/pocketbase serve --http=$PB_HTTP --dir=$PB_DIR/pb_data
Restart=always
RestartSec=5
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
EOF

mkdir -p "$PB_DIR/pb_data"

set +e
"$PB_DIR/pocketbase" superuser create "$PB_EMAIL" "$PB_PASSWORD" --dir="$PB_DIR/pb_data" >/dev/null 2>&1
set -e

sudo systemctl daemon-reload
sudo systemctl enable travai-pocketbase.service
sudo systemctl restart travai-pocketbase.service
sleep 4
systemctl --no-pager --full status travai-pocketbase.service | sed -n '1,25p'

cd "$APP_DIR"
node scripts/setup-pocketbase.mjs

if [[ -f "$APP_DIR/.local-cache/local-crm-store.json" ]]; then
  node scripts/migrate-local-cache-to-pocketbase.mjs
fi

echo "PocketBase installed and bootstrapped."
echo "Superuser env saved to $PB_ENV_FILE"
