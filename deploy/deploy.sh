#!/usr/bin/env bash
# BCC-Alert server deploy: Outlook add-in static bundle + license API.
# Wire this script to your GitHub webhook (bcc-alert repo) or run manually on the VPS.
set -euo pipefail
exec >> /var/log/bcc-alert-deploy.log 2>&1

LOCK_FILE="/tmp/bcc-alert-deploy.lock"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[deploy] another deploy is already running"
  exit 0
fi

REPO_DIR="${BCC_ALERT_REPO_DIR:-/root/erlix/bcc-alert}"
ADDIN_DEST="${BCC_ADDIN_DEST:-/var/www/bcc-alert-addin/addin}"
BRANCH="${BCC_DEPLOY_BRANCH:-master}"

echo "[deploy] starting at $(date -u +%FT%TZ)"
trap 'echo "[deploy] failed at $(date -u +%FT%TZ)"' ERR

cd "${REPO_DIR}"
git fetch origin "${BRANCH}"
git checkout -f "${BRANCH}"
git reset --hard "origin/${BRANCH}"
git clean -fd

# --- License API (Flask on :5002) ---
cd "${REPO_DIR}/backend"
python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
cp -f "${REPO_DIR}/deploy/bcc-license-api.service" /etc/systemd/system/bcc-license-api.service
systemctl daemon-reload
systemctl enable bcc-license-api
systemctl restart bcc-license-api

# --- Outlook add-in static bundle ---
mkdir -p "${ADDIN_DEST}"
rm -rf "${ADDIN_DEST:?}"/*
cp -a "${REPO_DIR}/outlook-smart-alerts-addin/hosting/bcc-alert/addin/." "${ADDIN_DEST}/"
chown -R www-data:www-data "${ADDIN_DEST}" 2>/dev/null || true

systemctl reload nginx 2>/dev/null || true

echo "[deploy] completed at $(date -u +%FT%TZ)"
