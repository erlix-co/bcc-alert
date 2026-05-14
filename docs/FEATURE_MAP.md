# FEATURE MAP

## Gmail: Visible Recipients Warning
- **Feature**: Warn before send when visible recipients exceed policy.
- **Entry point**: `gmail-web-extension/src/content.js` (click capture + send button hooks).
- **Key files**:
- `gmail-web-extension/src/content.js`
- `gmail-web-extension/manifest.json`
- `gmail-web-extension/src/styles.css`

## Gmail: Send-Anyway One-Shot Bypass
- **Feature**: Allow a single intentional send after warning.
- **Entry point**: popup button handlers in `content.js`.
- **Key files**:
- `gmail-web-extension/src/content.js`

## Gmail: Blocked Counter + Debug Toggle
- **Feature**: Persist blocked attempts and expose reset/debug in extension popup.
- **Entry point**: extension action popup.
- **Key files**:
- `gmail-web-extension/src/popup.js`
- `gmail-web-extension/src/content.js` (counter updates)
- `gmail-web-extension/manifest.json`

## Outlook: Smart Alerts Send Gate
- **Feature**: Hard pre-send decision in Outlook clients via `OnMessageSend`.
- **Entry point**: `onMessageSendHandler` in `outlook-smart-alerts-addin/src/launchevent.js`.
- **Key files**:
- `outlook-smart-alerts-addin/src/launchevent.js`
- `outlook-smart-alerts-addin/manifest*.xml`

## Outlook: Group/Distribution List Heuristic
- **Feature**: Escalate warning when recipient appears to be group/list alias.
- **Entry point**: recipient assessment flow in `launchevent.js`.
- **Key files**:
- `outlook-smart-alerts-addin/src/launchevent.js`

## Outlook: Runtime Telemetry (Non-Blocking)
- **Feature**: Track allowed/blocked buckets for operational visibility.
- **Entry point**: telemetry calls in `launchevent.js` to `/api/metrics`.
- **Key files**:
- `outlook-smart-alerts-addin/src/launchevent.js`
- `outlook-smart-alerts-addin/server.js`

## Deployment Feature Split (Critical)
- **Feature**: Separate public site vs add-in runtime path.
- **Entry point**: deployment process, not runtime code.
- **Key files**:
- `README_DEPLOY.md`
- `outlook-smart-alerts-addin/manifest.template.xml`
- `outlook-smart-alerts-addin/manifest.production.xml`
# Feature Map

## Feature: Outlook pre-send visible-recipient guard
- **What it does**
  - Evaluates `To + Cc` recipients on send.
  - Blocks send when visible recipients exceed policy threshold (currently > 1).
  - Uses group/list heuristics to treat likely distribution lists conservatively.
- **Primary files**
  - `outlook-smart-alerts-addin/src/launchevent.js`
  - `outlook-smart-alerts-addin/manifest.production.xml`
- **Entry point**
  - `onMessageSendHandler` associated through Office actions in `launchevent.js`.

## Feature: Outlook compose runtime/taskpane guidance
- **What it does**
  - Renders warning/safe state in runtime UI.
  - Updates compose notifications and status text.
- **Primary files**
  - `outlook-smart-alerts-addin/src/commands.html`
  - `outlook-smart-alerts-addin/src/taskpane.js`
- **Entry point**
  - `Office.onReady(...)` in `taskpane.js`.

## Feature: Outlook telemetry (best effort)
- **What it does**
  - Emits decision metrics (`allowed`/`blocked`) to `/api/metrics`.
- **Primary files**
  - `outlook-smart-alerts-addin/src/launchevent.js`
  - `outlook-smart-alerts-addin/server.js` (dev endpoint implementation)
- **Entry point**
  - `reportDecisionMetric(...)` calls from send/taskpane flows.

## Feature: Outlook manifest/build/deploy pipeline
- **What it does**
  - Generates production manifest from template and env vars.
  - Builds deploy bundle from source/assets/support.
  - Optional remote upload/deploy.
- **Primary files**
  - `outlook-smart-alerts-addin/tools/build-manifest.js`
  - `outlook-smart-alerts-addin/tools/build-hosting-bundle.js`
  - `outlook-smart-alerts-addin/tools/deploy_addin_bundle.py`
- **Entry point**
  - npm scripts in `outlook-smart-alerts-addin/package.json`.

## Feature: Gmail send interception popup
- **What it does**
  - Captures send intent in Gmail web compose/reply/forward.
  - Warns when multiple visible recipients found.
  - Provides "send anyway" bypass flow.
- **Primary files**
  - `gmail-web-extension/src/content.js`
  - `gmail-web-extension/src/styles.css`
- **Entry point**
  - content script injection defined in `gmail-web-extension/manifest.json`.

## Feature: Gmail popup stats/debug controls
- **What it does**
  - Shows blocked count and allows reset.
  - Toggles debug mode flag in local storage.
- **Primary files**
  - `gmail-web-extension/src/popup.html`
  - `gmail-web-extension/src/popup.js`
  - `gmail-web-extension/_locales/*/messages.json`
- **Entry point**
  - browser action popup configured in `gmail-web-extension/manifest.json`.
