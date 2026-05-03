# BCC Alert - Outlook Smart Alerts

This project is a separate Outlook implementation of BCC Alert using Office Add-ins Smart Alerts (`OnMessageSend`) instead of DOM interception.

## Why this architecture

- Reliable pre-send interception in Outlook Web / New Outlook / Classic Outlook clients that support Mailbox 1.12+.
- Better than browser DOM hooks for long-term stability.

## Current behavior

- On **new message compose**, the add-in runtime starts in the background (`OnNewMessageCompose`; no UI).
- On send, counts unique recipients in `To + Cc`.
- If visible recipients count is greater than 1, send is stopped with a warning message.
- If visible recipients count is 1 or less, send is allowed.

## Project files

Manifests (only these three):

- `manifest.xml` — **local dev** (`https://localhost:3000/...`). Use with `npm start` and sideloading from disk.
- `manifest.template.xml` — **source** for production URLs (`__BASE_URL__` placeholders). Do not upload as-is.
- `manifest.production.xml` — **generated** by `npm run manifest:build` from the template. Upload this to the admin center / production sideload when the add-in is hosted on your HTTPS URL.

Also:

- `src/commands.html`: Runtime page loaded by Outlook.
- `src/launchevent.js`: Event handler logic.

## Important notes

- This is Outlook Add-in code, not a browser extension.
- You must host files over HTTPS (example placeholders use `https://localhost:3000`).
- Smart Alerts support depends on Outlook client and requirement set support.

## Run locally

1. In this folder, run `npm install` (already done if dependencies exist).
2. Run `npm start`.
3. Keep the process running while testing in Outlook.

## Clean project separation

This Outlook add-in stays fully inside this project:
- `C:\Erlix\BCC-Alert\outlook-smart-alerts-addin`

Do not place add-in runtime files under `LinkCheck`.

## Event-based activation (no manual “open add-in”)

Smart Alerts (`OnMessageSend`) must run without the user opening the task pane first.

- The manifest declares a [`Runtimes`](https://learn.microsoft.com/office/dev/add-ins/outlook/autolaunch) block with `WebViewRuntime.Url` (HTML used on the web / Mac / New Outlook) and `Override type="javascript"` → `JSRuntime.Url` pointing at `src/launchevent.js` (used by **classic Outlook on Windows** so the handler loads without opening `commands.html`).
- `OnNewMessageCompose` is registered with a no-op handler that only calls `event.completed({ allowEvent: true })` so the runtime starts when a **new** compose item opens, keeping send-time behavior reliable across clients.

## Build hosting bundle

Generate deploy-ready static files from this project only:

- `npm run hosting:build`

Output folder:
- `hosting/bcc-alert/addin`

You can upload this folder to your server path:
- `https://erlix.net/bcc-alert/addin`

This keeps your homepage `https://erlix.net/bcc-alert/` separate.

## Build a production manifest (non-localhost)

`Integrated apps` deployment rejects localhost URLs. Generate a production manifest with your public HTTPS base URL:

1. Host this add-in content under your domain (must include `/src/*` and `/assets/*`).
2. Build manifest:
   - PowerShell:
     - `$env:BASE_URL="https://your-domain/path"`
     - `npm run manifest:build`
3. Validate manifest:
   - `npm run manifest:validate`
4. Upload `manifest.production.xml` in Microsoft 365 admin center (`Integrated apps`).

Notes:
- `BASE_URL` must be HTTPS and publicly reachable by Microsoft 365 clients.
- Optional overrides:
  - `ICON_URL` (default: `${origin}/linkcheck/logo.png`)
  - `HIGH_ICON_URL` (default: `ICON_URL`)
  - `SUPPORT_URL` (default: `${BASE_URL}/support/`)
- Runtime telemetry posts to `{add-in base}/api/metrics` (for example `https://erlix.net/bcc-alert/addin/api/metrics` when the add-in is under `/bcc-alert/addin/`). The Erlix `home` site build includes a small dev/preview handler for that path; on a static host, failed telemetry is ignored and does not block send.

Recommended value for this project:
- `BASE_URL=https://erlix.net/bcc-alert/addin`

## Sideload in Outlook on the web

1. Open Outlook on the web.
2. Open **Get Add-ins** > **My add-ins** > **Add a custom add-in** > **Add from file**.
3. Select `manifest.xml` from this folder.
4. Compose a new message and test send behavior.

## Sideload in Outlook Classic (Windows desktop)

**This is not the right place:** **File → Options → Add-ins → Manage: COM Add-ins → Go → Add…**  
That dialog only registers legacy **COM** add-ins (`.dll`). A web add-in manifest (`.xml`) is **not** a COM add-in, so Outlook shows an error like *“is not a valid Office add-in”* — that is expected if you browse to `manifest.production.xml` there.

**Use a web add-in path instead:**

1. On the **Home** ribbon, open **Get Add-ins** (wording may vary by language, e.g. add-ins / store entry).
2. Go to **My add-ins** → **Add a custom add-in** → **Add from File…** and choose `manifest.production.xml` (or `manifest.xml` for localhost testing).

If you do not see **Get Add-ins** on the ribbon, try **File → Info** and look for **Manage Add-ins** (often opens the browser to manage add-ins for the mailbox). Organization-wide install uses **Microsoft 365 admin center** (Integrated apps / centralized deployment) with the same manifest — users then get the add-in without sideloading.

## Validation scenarios

- 1 recipient in `To/Cc`: send allowed.
- 2+ recipients in `To/Cc`: warning shown before send.
- `Bcc`-only recipients: no warning.

## Next steps

1. Add localization for Smart Alerts message text.
2. Add analytics counter (aggregate only, no recipient storage).
3. Package organization deployment artifacts for Microsoft 365 admin center.
   - 1 recipient in To/Cc: send allowed
   - 2+ recipients in To/Cc: warning shown before send
   - Bcc-only recipients: no warning
