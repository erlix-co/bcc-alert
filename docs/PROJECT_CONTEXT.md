# PROJECT CONTEXT

## Purpose
- BCC Alert is a dual-product workspace:
- Gmail browser extension that warns before sending to multiple visible recipients (`To/Cc`).
- Outlook Smart Alerts add-in that blocks risky sends at `OnMessageSend` level.

## Main Technologies
- Gmail side: Chrome Extension (Manifest V3), plain JavaScript content script + popup UI, `chrome.storage`.
- Outlook side: Office Add-in (Mailbox 1.12+), event-based activation (`OnNewMessageCompose`, `OnMessageSend`), Node/Express host for runtime + telemetry endpoint.
- Deployment: static hosting for extension assets + HTTPS hosting for Outlook add-in runtime and manifests.

## High-Level Architecture
- `gmail-web-extension/`: client-side DOM interception in Gmail (`mail.google.com`), warning popup, local blocked counter.
- `outlook-smart-alerts-addin/`: server-hosted Office runtime; decision logic runs in `launchevent.js` and completes send event with allow/block payload.
- Root folder holds shared operational docs and media assets.

## Core Features
- Gmail: pre-send warning when visible recipient count is above threshold; `Send anyway` one-shot bypass; popup styling/branding.
- Outlook: deterministic send decision with timeout/watchdog; visible recipient assessment including group heuristics; lightweight metrics reporting.

## Important Conventions
- Do not mix Outlook deployment roots:
- Public site: `/bcc-alert/`
- Add-in runtime: `/bcc-alert-addin/addin/`
- Gmail extension logic is intentionally conservative and DOM-dependent; changes should be incremental and validated across compose modes (`new`, `reply`, `reply all`, `forward`).
- Outlook send handler must always call `event.completed(...)` safely (watchdog/timeout patterns are intentional).

## Sensitive Areas (easy to break)
- `gmail-web-extension/src/content.js`: selector/container heuristics; small changes can reintroduce false positives or missed warnings.
- `outlook-smart-alerts-addin/src/launchevent.js`: send-flow completion and timeout safety; blocking logic tied to Office runtime constraints.
- Outlook manifests (`manifest*.xml`): URL correctness and requirement-set declarations are critical for activation.
# Project Context

## Purpose
- `BCC-Alert` is a workspace with two related products that reduce accidental visible-recipient sending:
  - `outlook-smart-alerts-addin` (Outlook Smart Alerts add-in)
  - `gmail-web-extension` (Chrome extension for Gmail web UI)

## Main Technologies
- **Outlook add-in:** JavaScript (CommonJS), Office.js (Mailbox 1.12), HTML/CSS, Node.js scripts, Express (dev host), Python deploy helper.
- **Gmail extension:** Chrome Extension Manifest V3, content script + popup UI, localized strings (`_locales`), Chrome storage API.

## High-Level Architecture
- Shared repo, two independent runtime targets.
- Outlook flow is event-based (`OnMessageSend`) with runtime loaded from hosted URLs in manifest.
- Gmail flow is DOM interception via content script on `mail.google.com`.

## Core Features
- Detect risky send attempts when multiple visible recipients exist in `To/Cc`.
- Warn/block before send (platform-specific UX).
- Keep aggregate counters (local storage for Gmail; roaming settings logic exists in Outlook runtime).
- Basic telemetry/metrics in Outlook runtime (best-effort, non-blocking).

## Important Conventions
- **Do not confuse source and deploy output** in Outlook add-in:
  - Source: `outlook-smart-alerts-addin/src`
  - Deploy bundle: `outlook-smart-alerts-addin/hosting/bcc-alert/addin`
- Production Outlook path is separated from public site path:
  - Public site: `/bcc-alert/`
  - Add-in runtime: `/bcc-alert-addin/addin/`
- `manifest.production.xml` is generated from `manifest.template.xml` via `BASE_URL`.

## Sensitive Areas (High Break Risk)
- `outlook-smart-alerts-addin/src/launchevent.js`:
  - `OnMessageSend` timing and `event.completed(...)` reliability are critical.
- Outlook manifests (`manifest.production.xml`, `manifest.template.xml`):
  - URL mistakes break runtime loading in production.
- Gmail content script (`gmail-web-extension/src/content.js`):
  - tightly coupled to Gmail DOM and sender button behavior.
