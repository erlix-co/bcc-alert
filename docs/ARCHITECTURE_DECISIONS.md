# ARCHITECTURE DECISIONS

## 1) Two Separate Products in One Workspace
- **Decision**: Keep Gmail extension and Outlook add-in as independent implementations.
- **Why**: Platform capabilities differ; Outlook supports event-based send interception, Gmail requires DOM interception.
- **Impact**: Shared business intent, separate runtime mechanics and deployment pipelines.

## 2) Gmail Uses Content-Script Interception (No Backend Dependency)
- **Decision**: Do send warning entirely in-browser via content script.
- **Why**: Lowest-latency interception and simple deployment; no recipient data sent to server.
- **Dependencies**: Gmail DOM structure, extension host permissions, `chrome.storage`.

## 3) Outlook Uses Smart Alerts (`OnMessageSend`) with Safety Timeouts
- **Decision**: Gate send in `launchevent.js` and always complete event via safe completion path.
- **Why**: Office runtime can terminate quickly; timeout/watchdog avoids stuck send operations.
- **Dependencies**: Office.js, Mailbox requirement set support, manifest launch event wiring.

## 4) Privacy-Minimal Persistence
- **Decision**: Store aggregate counters only (Gmail local storage / Outlook roaming settings), not recipient identities.
- **Why**: Keep privacy footprint low while preserving operational UX feedback.

## 5) Strict Deployment Path Separation
- **Decision**: Add-in runtime hosted only under `/bcc-alert-addin/addin/`, not under public `/bcc-alert/`.
- **Why**: Prevent routing collisions and stale asset loading in production.
- **Dependencies**: NGINX/site routing, manifest base URLs, hosting bundle location.

## 6) Conservative Group Detection in Outlook
- **Decision**: Treat likely distribution groups as elevated risk even when unique visible count appears low.
- **Why**: Privacy impact can still be high with aliases/lists.
- **Tradeoff**: Potentially stricter behavior in ambiguous naming cases.

## 7) Incremental Change Strategy for Gmail
- **Decision**: Make small, scoped changes to send interception and selector logic.
- **Why**: Broad refactors in DOM-dependent code have high regression risk across compose modes.
# Architecture Decisions

## 1) Two-product workspace instead of one unified runtime
- **Decision**
  - Keep Outlook and Gmail implementations as separate modules in the same repository.
- **Why**
  - Different platforms, APIs, and deployment models require separate runtime logic.

## 2) Outlook uses Office Smart Alerts event-based flow
- **Decision**
  - Use `OnMessageSend` + `OnNewMessageCompose` Office event handlers.
- **Why**
  - More reliable and platform-native for Outlook clients than browser-style DOM interception.
- **Impact**
  - Timing constraints dominate architecture; completion must be deterministic.

## 3) Deterministic completion over perfect data freshness
- **Decision**
  - Favor fast/fail-open completion in Outlook handler, move side effects to fire-and-forget.
- **Why**
  - Prevent timeout dialogs and maintain send flow reliability under slow Office APIs.

## 4) Separate public site path and add-in runtime path
- **Decision**
  - Public site at `/bcc-alert/`, add-in runtime at `/bcc-alert-addin/addin/`.
- **Why**
  - Avoid collisions and accidental overwrite/404 from website deployment changes.
- **Impact**
  - Manifest URLs and NGINX routing must remain aligned with this split.

## 5) Build output committed as deployment artifact
- **Decision**
  - Keep `hosting/bcc-alert/addin/` as generated deploy bundle in repo workflow.
- **Why**
  - Supports explicit deployment flow and direct upload scripts.
- **Tradeoff**
  - Risk of source/build divergence if build step is skipped.

## 6) Gmail interception via content script and DOM heuristics
- **Decision**
  - Implement warning logic in `content.js` with selector/structure heuristics.
- **Why**
  - Gmail has no first-class pre-send policy hook comparable to Outlook Smart Alerts.
- **Tradeoff**
  - High sensitivity to Gmail UI markup changes.

## Important Dependencies
- Outlook module: `express`, `office-addin-dev-certs`, Office.js runtime.
- Gmail module: Chrome Extension MV3 APIs (`storage`, content scripts).
- Deployment helper: Python `paramiko` for SSH/SFTP upload.

## Core Flows (Operational)
- **Outlook**
  - Manifest URL -> runtime scripts -> `onMessageSendHandler` decision -> complete event -> optional background side effects.
- **Gmail**
  - content script captures send click -> recipient analysis -> warning popup/bypass -> send proceeds or canceled.

## Uncertainties to Keep in Mind
- Exact production NGINX config is not versioned in this repo.
- Microsoft Admin rollout behavior/timing is external to source control.
