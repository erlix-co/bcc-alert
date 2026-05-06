## Subject
Outlook add-in manifest rejected when using `OnMessageSend` (`LaunchEvent`) in tenant upload

## Tenant context
- Tenant admin UPN: `admin@Erlix.onmicrosoft.com`
- Tenant is new (created for this project)
- `OwaMailboxPolicy` `OnSendAddinsEnabled` is set to `True`

## Problem
Regular Outlook manifests upload successfully in `Integrated apps`, but any manifest containing:

`<LaunchEvent Type="OnMessageSend" ... />`

is rejected with:

`Invalid manifest file`

## Repro summary
At the time of the ticket: manifests **without** `OnMessageSend` uploaded successfully to `Integrated apps`, while manifests **with** `OnMessageSend` (`LaunchEvent`) were rejected as `Invalid manifest file`, even though `npx office-addin-manifest validate manifest.production.xml` passed.

The repository now keeps only `manifest.xml` (localhost), `manifest.template.xml` (source), and `manifest.production.xml` (deploy); older probe/fallback XMLs were removed as clutter.

## Runtime URLs (public, HTTPS, returning 200)
- `https://erlix.net/bcc-alert-addin/addin/src/commands.html`
- `https://erlix.net/bcc-alert-addin/addin/src/launchevent.js`
- `https://erlix.net/bcc-alert-addin/addin/support/`
- `https://erlix.net/bcc-alert-addin/addin/assets/icon-64.png`
- `https://erlix.net/bcc-alert-addin/addin/assets/icon-128.png`

## Request
Please verify and enable tenant/service support for Outlook Smart Alerts / Event-based activation (`OnMessageSend`) in Exchange Online for this tenant, or provide the exact tenant-side prerequisite currently blocking this manifest type.
