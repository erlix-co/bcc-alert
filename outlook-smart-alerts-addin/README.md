# BCC Alert - Outlook Smart Alerts

This project is a separate Outlook implementation of BCC Alert using Office Add-ins Smart Alerts (`OnMessageSend`) instead of DOM interception.

## Why this architecture

- Reliable pre-send interception in Outlook Web / New Outlook / Classic Outlook clients that support Mailbox 1.12+.
- Better than browser DOM hooks for long-term stability.

## Current behavior

- On send, counts unique recipients in `To + Cc`.
- If visible recipients count is greater than 1, send is stopped with a warning message.
- If visible recipients count is 1 or less, send is allowed.

## Project files

- `manifest.xml`: Add-in manifest with `LaunchEvent Type="OnMessageSend"` and `SendMode="PromptUser"`.
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

## Sideload in Outlook on the web

1. Open Outlook on the web.
2. Open **Get Add-ins** > **My add-ins** > **Add a custom add-in** > **Add from file**.
3. Select `manifest.xml` from this folder.
4. Compose a new message and test send behavior.

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
