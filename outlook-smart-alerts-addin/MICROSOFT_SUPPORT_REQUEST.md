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
1. Upload `manifest.diagnostic.xml` (no `OnMessageSend`) -> succeeds.
2. Upload `manifest.probe-onsend.xml` (adds `OnMessageSend`) -> fails with invalid manifest.
3. Upload `manifest.production.xml` (full Smart Alerts config) -> fails with invalid manifest.

All manifests validate successfully via:

`npx office-addin-manifest validate <file>`

## Runtime URLs (public, HTTPS, returning 200)
- `https://erlix.net/bcc-alert/addin/src/commands.html`
- `https://erlix.net/bcc-alert/addin/src/launchevent.js`
- `https://erlix.net/bcc-alert/addin/support/`
- `https://erlix.net/bcc-alert/addin/assets/icon-64.png`
- `https://erlix.net/bcc-alert/addin/assets/icon-128.png`

## Request
Please verify and enable tenant/service support for Outlook Smart Alerts / Event-based activation (`OnMessageSend`) in Exchange Online for this tenant, or provide the exact tenant-side prerequisite currently blocking this manifest type.
