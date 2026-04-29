# Visible Recipients Guard (Web-First MVP)

Browser extension MVP for Gmail Web and Outlook Web.

## What it does

- Intercepts send attempts on `To + Cc` visible fields.
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
4. Open Gmail Web or Outlook Web compose window.
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

- This is an MVP; recipient extraction still depends on provider DOM and can require tuning.
- Mobile apps and native desktop clients are not covered by this web package.
