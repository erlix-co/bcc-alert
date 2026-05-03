# Visible Recipients Guard (Web-First MVP)

Chrome extension for **Gmail in the browser** (personal Gmail and **Google Workspace** — same `mail.google.com` UI).

> **Google Workspace packaging:** use this folder as the single source of truth. The duplicate `google-workspace-extension` folder was removed; deploy this extension via Chrome Browser management (see end).

## What it does

- Intercepts send attempts on `To + Cc` visible fields in **new compose**, **reply / reply all**, and **forward** (inline compose without `role=dialog` is supported).
- Uses **document-level click capture** so it still works when Gmail swaps the Send control before you type in subject/body (empty forward/reply).
- Ignores `Bcc` by design.
- Warns when:
  - more than one visible recipient is detected, or
  - recipient entity is unresolved (treated as potential list/group).
- Shows two actions:
  - `Back` (return to editing)
  - `Send anyway` (allow sending)
- Tracks only aggregate warning count in local storage (`vrg_blocked_count`).

## Practical test flow

1. Open browser extension page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable Developer Mode.
3. Click **Load unpacked** and select this project folder.
4. Open Gmail (new message, **Reply**, **Reply all**, or **Forward**) and test send.
5. Run quick checks:
   - 1 recipient in `To`: no warning.
   - 2 recipients in `To`: warning appears.
   - 1 in `To` + 1 in `Cc`: warning appears.
   - only `Bcc`: no warning.
6. Click the extension icon to view the blocked-send counter.
7. Use popup **Reset counter** between test rounds.

## Privacy

- No recipient address persistence.
- No recipient identifiers persisted.
- Only aggregate count is stored.

## Notes

- This is an MVP; recipient extraction still depends on Gmail’s DOM and can require tuning after Google UI changes.
- Mobile apps and native desktop clients are not covered by this web package.

## Google Workspace (enterprise)

- Deploy with **Chrome Browser Cloud Management** (Admin console → **Devices → Chrome → Apps & extensions**), private Chrome Web Store listing, or `ExtensionInstallForcelist`. See [Chrome enterprise policies](https://chromeenterprise.google/policies/).
