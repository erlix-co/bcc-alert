# BCC Alert Add-in — Deployment Structure

## Overview

This project contains two separate layers:

1. Development source code
2. Production bundle (served to Outlook)

It is critical to understand the difference.

---

## Source Code (DO NOT SERVE DIRECTLY)

Path:
outlook-smart-alerts-addin/src/

Description:
This is the development source code.

- This is where changes should be made
- This code is NOT served directly to Outlook
- Changes here require a build step

---

## Production Bundle (USED BY OUTLOOK)

Path:
outlook-smart-alerts-addin/hosting/bcc-alert/addin/

This folder contains the built version of the add-in.

This is the ONLY code that Outlook actually loads.

---

## Public URL (Served by NGINX)

The production bundle is exposed via NGINX at:

https://erlix.net/bcc-alert/

Example:
https://erlix.net/bcc-alert/addin/src/launchevent.js

This maps to:

/var/www/bcc-alert/addin/

---

## Critical Rule

Outlook NEVER uses files from the src/ folder directly.

It ONLY loads files from:

outlook-smart-alerts-addin/hosting/bcc-alert/addin/

---

## Build & Deploy Flow

When making changes:

1. Modify files under:
   outlook-smart-alerts-addin/src/

2. Build the hosting bundle:
   npm run hosting:build

3. Deploy to web directory:
   Copy contents to:
   /var/www/bcc-alert/

4. Restart / reload NGINX if needed

5. Restart Outlook to clear cache

---

## Important Warnings

- Updating src/ without rebuilding hosting bundle will NOT affect Outlook
- If the production URL returns 404 or 403, the add-in will break
- Outlook aggressively caches files — restart Outlook after deploy
- Always verify changes via browser:
  https://erlix.net/bcc-alert/addin/src/launchevent.js

---

## For AI Agents (Cursor / Automation)

NEVER assume src/ is used in production.

ALWAYS ensure:

- Changes are reflected in hosting/bcc-alert/addin/
- Files are accessible via:
  https://erlix.net/bcc-alert/

Failure to do so will result in outdated code being used in Outlook.

---

## Summary

Source → Build → Hosting → NGINX → Outlook

ONLY the hosting bundle is used in production.
