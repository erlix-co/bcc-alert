#!/usr/bin/env bash
# Deploy Outlook add-in static bundle only (no licensing-api).
set -euo pipefail
exec >> /var/log/bcc-alert-addin-deploy.log 2>&1

LOCK_FILE="/tmp/bcc-alert-addin-deploy.lock"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[deploy] another add-in deploy is already running"
  exit 0
fi

REPO_DIR="${BCC_ALERT_REPO_DIR:-/root/erlix/bcc-alert}"
ADDIN_DEST="${BCC_ADDIN_DEST:-/var/www/bcc-alert-addin/addin}"
BRANCH="${BCC_DEPLOY_BRANCH:-master}"

echo "[deploy] add-in starting at $(date -u +%FT%TZ)"
trap 'echo "[deploy] add-in failed at $(date -u +%FT%TZ)"' ERR

cd "${REPO_DIR}"
git fetch origin "${BRANCH}"
git checkout -f "${BRANCH}"
git reset --hard "origin/${BRANCH}"
git clean -fd

mkdir -p "${ADDIN_DEST}"
rm -rf "${ADDIN_DEST:?}"/*
cp -a "${REPO_DIR}/outlook-smart-alerts-addin/hosting/bcc-alert/addin/." "${ADDIN_DEST}/"
chown -R www-data:www-data "${ADDIN_DEST}" 2>/dev/null || true

systemctl reload nginx 2>/dev/null || true

echo "[deploy] add-in completed at $(date -u +%FT%TZ)"
