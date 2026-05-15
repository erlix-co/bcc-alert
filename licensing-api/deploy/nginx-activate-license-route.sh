#!/usr/bin/env bash
# Activate licensing-api on erlix.net: include snippet BEFORE generic location /api/.
# Safe: backs up site file, skips if already included, runs nginx -t before reload.
set -euo pipefail

SNIPPET_SRC="${SNIPPET_SRC:-/root/erlix/licensing-api/deploy/nginx-license-status.snippet.conf}"
SNIPPET_DST="/etc/nginx/snippets/erlix-license-status.conf"
INCLUDE_LINE='include /etc/nginx/snippets/erlix-license-status.conf;'
MARKER="erlix-license-status.conf"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[nginx] ERROR: run as root (sudo)"
  exit 1
fi

if [[ -f "${SNIPPET_SRC}" ]]; then
  cp -f "${SNIPPET_SRC}" "${SNIPPET_DST}"
  echo "[nginx] installed snippet -> ${SNIPPET_DST}"
elif [[ ! -f "${SNIPPET_DST}" ]]; then
  echo "[nginx] ERROR: snippet missing at ${SNIPPET_DST}"
  exit 1
fi

mapfile -t CANDIDATES < <(
  grep -rlE 'server_name[[:space:]].*erlix\.net' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null || true
)

if [[ ${#CANDIDATES[@]} -eq 0 ]]; then
  echo "[nginx] ERROR: no nginx config with server_name erlix.net found"
  exit 1
fi

pick_site_file() {
  local f
  for f in "${CANDIDATES[@]}"; do
    if grep -qE 'listen[[:space:]].*443|ssl_certificate' "$f" 2>/dev/null; then
      echo "$f"
      return 0
    fi
  done
  echo "${CANDIDATES[0]}"
}

SITE_FILE="$(pick_site_file)"
echo "[nginx] using site file: ${SITE_FILE}"

if grep -q "${MARKER}" "${SITE_FILE}"; then
  echo "[nginx] include already present in ${SITE_FILE} — skipping edit"
else
  BACKUP="${SITE_FILE}.bak.$(date +%Y%m%d%H%M%S)"
  cp -a "${SITE_FILE}" "${BACKUP}"
  echo "[nginx] backup: ${BACKUP}"

  TMP="$(mktemp)"
  if awk -v inc="    ${INCLUDE_LINE}" '
    BEGIN { inserted = 0 }
    {
      if (!inserted && $0 ~ /^[[:space:]]*location[[:space:]]+(\^~[[:space:]]+)?\/api\//) {
        print inc
        inserted = 1
      }
      print
    }
    END { exit(inserted ? 0 : 2) }
  ' "${SITE_FILE}" > "${TMP}"; then
    mv "${TMP}" "${SITE_FILE}"
    echo "[nginx] inserted include before generic /api/ location"
  else
    rm -f "${TMP}"
    echo "[nginx] ERROR: could not find 'location /api/' or 'location ^~ /api/' in ${SITE_FILE}"
    echo "[nginx] Add manually inside the erlix.net HTTPS server block:"
    echo "    ${INCLUDE_LINE}"
    exit 1
  fi
fi

echo "[nginx] validating config..."
nginx -t

echo "[nginx] reloading nginx..."
systemctl reload nginx

echo "[nginx] local check (licensing-api :5003):"
curl -sf "http://127.0.0.1:5003/license-status?email=admin@erlix.onmicrosoft.com" || true

echo "[nginx] public check:"
curl -sf "https://erlix.net/api/license-status?email=admin@erlix.onmicrosoft.com" || true
echo ""
