#!/usr/bin/env bash
# Standalone deploy for licensing-api only (no LinkCheck, no Outlook add-in bundle).
# Wire to a dedicated GitHub webhook or run manually on the VPS.
set -euo pipefail
exec >> /var/log/licensing-api-deploy.log 2>&1

LOCK_FILE="/tmp/licensing-api-deploy.lock"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[deploy] another licensing-api deploy is already running"
  exit 0
fi

REPO_DIR="${LICENSING_REPO_DIR:-/root/erlix/bcc-alert}"
LICENSE_ROOT="${LICENSING_API_ROOT:-/root/erlix/licensing-api}"
BRANCH="${LICENSING_DEPLOY_BRANCH:-master}"
LISTEN_PORT=5003

echo "[deploy] licensing-api starting at $(date -u +%FT%TZ)"
trap 'echo "[deploy] licensing-api failed at $(date -u +%FT%TZ)"' ERR

cd "${REPO_DIR}"
git fetch origin "${BRANCH}"
git checkout -f "${BRANCH}"
git reset --hard "origin/${BRANCH}"
git clean -fd

mkdir -p "${LICENSE_ROOT}"
rsync -a --delete \
  --exclude ".venv" \
  --exclude "logs/*.log" \
  "${REPO_DIR}/licensing-api/" "${LICENSE_ROOT}/"

for _check_file in app.py config.py deploy/licensing-api.service deploy/nginx-license-status.snippet.conf; do
  if [[ -f "${LICENSE_ROOT}/${_check_file}" ]] && grep -q "5002" "${LICENSE_ROOT}/${_check_file}"; then
    echo "[deploy] ERROR: forbidden port 5002 in ${LICENSE_ROOT}/${_check_file}"
    exit 1
  fi
done

cd "${LICENSE_ROOT}"
python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt

# Retire legacy unit name from early migrations (does not touch home-webhook).
systemctl disable --now bcc-license-api 2>/dev/null || true
rm -f /etc/systemd/system/bcc-license-api.service

# Remove stale systemd drop-ins that might override PORT.
rm -rf /etc/systemd/system/licensing-api.service.d

cp -f "${LICENSE_ROOT}/deploy/licensing-api.service" /etc/systemd/system/licensing-api.service
systemctl daemon-reload
systemctl enable licensing-api
systemctl restart licensing-api

sleep 1
if curl -sf --max-time 5 "http://127.0.0.1:${LISTEN_PORT}/health" >/dev/null; then
  echo "[deploy] licensing-api health check OK (127.0.0.1:${LISTEN_PORT})"
else
  echo "[deploy] ERROR: health check failed on 127.0.0.1:${LISTEN_PORT}"
  journalctl -u licensing-api -n 30 --no-pager || true
  exit 1
fi

if command -v nginx >/dev/null 2>&1; then
  SNIPPET_SRC="${LICENSE_ROOT}/deploy/nginx-license-status.snippet.conf"
  SNIPPET_DST="/etc/nginx/snippets/erlix-license-status.conf"
  if [[ -f "${SNIPPET_SRC}" ]]; then
    cp -f "${SNIPPET_SRC}" "${SNIPPET_DST}"
    if nginx -t; then
      systemctl reload nginx
      echo "[deploy] nginx reloaded (license-status -> 127.0.0.1:${LISTEN_PORT})"
    else
      echo "[deploy] ERROR: nginx -t failed; not reloading"
      exit 1
    fi
  fi
fi

echo "[deploy] licensing-api completed at $(date -u +%FT%TZ)"
echo "[deploy] verify: curl -sS 'https://erlix.net/api/license-status?email=ierlich@gmail.com'"
