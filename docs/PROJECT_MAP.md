# PROJECT MAP

## Top-Level
- `README.md` — workspace summary (Gmail extension + Outlook add-in split).
- `README_DEPLOY.md` — critical deployment separation and URL contracts.
- `gmail-web-extension/` — Gmail extension product.
- `outlook-smart-alerts-addin/` — Outlook add-in product.

## Gmail Extension
- `gmail-web-extension/manifest.json` — extension metadata, permissions, content script registration.
- `gmail-web-extension/src/content.js` — main entry point; send interception, recipient counting, warning popup, bypass behavior.
- `gmail-web-extension/src/popup.js` — extension action popup logic (stats, reset, debug toggle).
- `gmail-web-extension/src/styles.css` — visual styling for injected warning UI.
- `gmail-web-extension/src/assets/*` — logos/icons used by popup and warning dialog.

### Gmail Entry Points
- Content script auto-runs on `https://mail.google.com/*`.
- Popup script runs when user opens extension action popup.

### Gmail Permissions
- `storage` permission for blocked counter/debug flag.
- `host_permissions` scoped to Gmail.

## Outlook Add-in
- `outlook-smart-alerts-addin/manifest.xml` — local dev manifest.
- `outlook-smart-alerts-addin/manifest.template.xml` — production template with placeholders.
- `outlook-smart-alerts-addin/manifest.production.xml` — generated deployable manifest.
- `outlook-smart-alerts-addin/src/launchevent.js` — send-time runtime logic (primary decision engine).
- `outlook-smart-alerts-addin/src/taskpane.js` — taskpane status/diagnostic UI layer.
- `outlook-smart-alerts-addin/src/commands.html` — runtime page referenced by manifest.
- `outlook-smart-alerts-addin/server.js` — local host for runtime files and `/api/metrics`.

### Outlook Entry Points
- Launch events: `OnNewMessageCompose`, `OnMessageSend` (from manifest runtime config).
- Local hosting entry: `server.js`.

### Services / API / Background
- `/api/metrics` in `server.js` receives allow/block telemetry.
- Background-like behavior exists in Office event handlers (not traditional worker service).

### Deployment/Config Files
- Outlook deployment: manifests + hosting output (`hosting/...` per README).
- Gmail deployment: unpacked/packaged extension from `gmail-web-extension/`.
# Project Map

## Repository Roots
- `README.md` — top-level workspace summary (Outlook add-in + Gmail extension).
- `README_DEPLOY.md` — deployment separation rules (public site vs Outlook runtime path).

## Outlook Add-in (`outlook-smart-alerts-addin`)
- **Entry points**
  - `manifest.production.xml` — production manifest consumed by Microsoft 365 admin deployment.
  - `manifest.xml` — localhost/dev manifest.
  - `src/launchevent.js` — main runtime handlers; includes `onMessageSendHandler`.
  - `src/commands.html` + `src/taskpane.js` — runtime page/taskpane UI logic.
- **Services/API**
  - `server.js` — local HTTPS/HTTP host for dev (`/src`, `/assets`, `/api/metrics`).
- **Background/event tasks**
  - `OnNewMessageCompose` and `OnMessageSend` handlers in `src/launchevent.js`.
- **Permissions/requirements**
  - Mailbox requirement set 1.12 in manifests.
  - `ReadWriteItem` permissions in manifest.
- **Build/deploy/config**
  - `tools/build-hosting-bundle.js` — copies source/assets/support to hosting bundle.
  - `tools/build-manifest.js` — renders `manifest.production.xml` from template + env vars.
  - `tools/deploy_addin_bundle.py` — uploads bundle to remote server via SSH/SFTP.
  - `tools/simulate-smart-alerts.js` — local simulation harness for send handler behavior.
  - `hosting/bcc-alert/addin/` — generated deploy output for runtime files.

## Gmail Extension (`gmail-web-extension`)
- **Entry points**
  - `manifest.json` — MV3 extension config, content script, popup.
  - `src/content.js` — Gmail send interception and warning popup behavior.
  - `src/popup.html` + `src/popup.js` — extension popup + counter/reset/debug controls.
- **UI/styling/i18n**
  - `src/styles.css`, `src/popup.css`
  - `_locales/en/messages.json`, `_locales/he/messages.json`
- **Permissions**
  - `storage`
  - `host_permissions`: `https://mail.google.com/*`

## Notes
- `node_modules` inside Outlook project exists for local tooling and should be treated as dependency output, not source.
