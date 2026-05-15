# BCC Alert Add-in — Deployment Structure

## Critical Separation

There are two different public paths and they must never be mixed:

- `https://erlix.net/bcc-alert/` = public marketing/product website
- `https://erlix.net/bcc-alert-addin/` = Outlook add-in hosting root

Outlook production files are served only from:

- `https://erlix.net/bcc-alert-addin/addin/`

## Source vs Production

Source code (edit here):

- `outlook-smart-alerts-addin/src/`

Built bundle (deploy this):

- `outlook-smart-alerts-addin/hosting\bcc-alert\addin\` (local build output folder)

Outlook never loads directly from `src/`.

## Production URLs (must resolve)

- `https://erlix.net/bcc-alert-addin/addin/src/commands.html`
- `https://erlix.net/bcc-alert-addin/addin/src/launchevent.js`
- `https://erlix.net/bcc-alert-addin/addin/assets/icon-64.png`
- `https://erlix.net/bcc-alert-addin/addin/assets/icon-128.png`
- `https://erlix.net/bcc-alert-addin/addin/support/`

## NGINX Routing Contract

- `/bcc-alert/` serves only the public site
- `/bcc-alert-addin/` serves only Outlook add-in files

Do not route legacy public-site add-in paths to runtime content.

## Build & Deploy Flow

1. Edit files under `outlook-smart-alerts-addin/src/`
2. Build bundle: `npm run hosting:build`
3. Build production manifest with:
   - `BASE_URL=https://erlix.net/bcc-alert-addin/addin`
   - `npm run manifest:build`
4. Deploy bundle contents to server path used by `/bcc-alert-addin/addin/`
5. Reload/restart NGINX if needed
6. Restart Outlook clients (cache)

## License API (`/api/license-status`) — standalone service

The Outlook add-in calls:

- `GET https://erlix.net/api/license-status?email=<mailbox>`

This is **not** served by LinkCheck. It runs as a separate service:

| Item | Value |
|------|--------|
| Source in repo | `licensing-api/` |
| Server runtime | `/root/erlix/licensing-api` |
| systemd unit | `licensing-api.service` (port **5003**, see `licensing-api/config.py`) |
| Deploy script | `licensing-api/deploy/deploy.sh` |

### Nginx

Include `licensing-api/deploy/nginx-license-status.snippet.conf` **before** any broad `location /api/` that proxies to LinkCheck, so only `/api/license-status` hits the licensing service.

### Deploy (licensing only)

```bash
bash /root/erlix/bcc-alert/licensing-api/deploy/deploy.sh
systemctl status licensing-api
journalctl -u licensing-api -f
```

### Deploy (add-in static files only)

```bash
bash /root/erlix/bcc-alert/deploy/deploy-addin.sh
```

### Verify

```text
curl "https://erlix.net/api/license-status?email=ierlich@gmail.com"
```

Expect: `{"status":"active","expiresAt":"2026-12-31T00:00:00Z"}`

After a successful response, the Outlook block dialog should show a real subscription line (days until expiry), not the cached/offline parenthetical.

## Verification Checklist

- Open `https://erlix.net/bcc-alert-addin/addin/src/launchevent.js` in browser and verify latest code.
- Confirm no production reference points to the old public-site add-in path.
- Confirm add-in manifest URLs all point to `/bcc-alert-addin/addin/`.

## For AI Agents (Cursor / Automation)

- Never deploy add-in runtime under `/bcc-alert/`.
- Never assume the public BCC website path hosts add-in runtime files.
- Always keep source/build/deploy separation:
  - source: `src/`
  - bundle: `hosting\bcc-alert\addin\`
  - production URL root: `https://erlix.net/bcc-alert-addin/addin/`
