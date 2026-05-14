# KNOWN ISSUES

## Gmail Extension
- Recipient detection relies on Gmail DOM structure; UI changes by Google can break either:
- warning not shown when expected, or
- warning shown in edge cases.
- Compose mode differences (`reply`, `reply all`, `forward`, windowed vs fullscreen) are historically sensitive.
- Send button identification is language/label dependent; custom UI variants may require selector updates.

## Outlook Add-in
- Smart Alerts require Mailbox 1.12+; unsupported clients can bypass advanced behavior.
- Runtime timing is sensitive: send decision must complete quickly; timeout/watchdog logic is required to avoid accidental hard failures.
- Group detection uses heuristics; conservative behavior can produce stricter-than-expected blocking in some alias naming patterns.

## Operational / Process Risks
- Deployment path confusion between `/bcc-alert/` and `/bcc-alert-addin/` is a known source of production issues.
- Manifest URL drift (template vs production output) can silently break add-in activation.

## TODO / Potential Improvements (from current code/docs)
- Add more deterministic Gmail compose scoping tests across viewport modes.
- Add automated regression checks for Gmail recipient counting scenarios.
- Keep Outlook telemetry endpoint contract documented near deployment scripts.

## Unclear Areas (needs future confirmation)
- Exact long-term stability of Gmail fallback selectors under new UI experiments is uncertain.
- No single centralized test matrix file was found for all Gmail compose permutations.
# Known Issues

## Confirmed/Observed Risks
- **Outlook Smart Alerts timeout sensitivity**
  - `OnMessageSend` has strict timing constraints; slow Office APIs can trigger generic timeout dialogs.
  - Current handler includes watchdog/timeout protections, but this area remains high-risk by nature.

- **Outlook deployment path drift risk**
  - Project recently moved production runtime path to `/bcc-alert-addin/addin/`.
  - Any mismatch between manifest URLs, NGINX routing, and deployed bundle causes runtime load failures.

- **Source vs hosting bundle confusion**
  - Editing `src/` without rebuilding/deploying `hosting/bcc-alert/addin/` does not update production behavior.

- **Gmail DOM fragility**
  - Gmail extension logic relies on Gmail DOM/selectors and send button detection.
  - UI changes by Google can regress interception logic without code changes in this repo.

## Sensitive Areas
- `outlook-smart-alerts-addin/src/launchevent.js` (timing/determinism)
- `outlook-smart-alerts-addin/manifest.production.xml` (runtime URLs)
- `gmail-web-extension/src/content.js` (DOM interception)

## Constraints / Known Limitations
- Outlook native Smart Alert dialog layout is controlled by Outlook; custom HTML placement inside that native dialog is limited.
- Telemetry endpoint failures are intentionally non-blocking (by design).
- Some docs mention support/investigation context; not all operational assumptions are enforced by code.

## TODOs / Follow-ups Seen in Repo
- Outlook README lists future enhancements (localization expansion, analytics packaging, deployment artifacts).
- No comprehensive automated test suite was found for either module (only Outlook simulation script exists).
