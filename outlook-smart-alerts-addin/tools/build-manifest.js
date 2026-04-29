"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const templatePath = path.join(projectRoot, "manifest.template.xml");
const outputPath = path.join(projectRoot, "manifest.production.xml");

const rawBaseUrl = process.env.BASE_URL;

if (!rawBaseUrl) {
  process.stderr.write("Missing BASE_URL. Example: BASE_URL=https://erlix.net/bcc-alert node tools/build-manifest.js\n");
  process.exit(1);
}

let parsedBaseUrl;
try {
  parsedBaseUrl = new URL(rawBaseUrl);
} catch (_error) {
  process.stderr.write("BASE_URL must be a valid URL.\n");
  process.exit(1);
}

if (parsedBaseUrl.protocol !== "https:") {
  process.stderr.write("BASE_URL must use HTTPS.\n");
  process.exit(1);
}

const normalizedBaseUrl = parsedBaseUrl.toString().replace(/\/$/, "");
const appDomain = parsedBaseUrl.origin;
const iconUrl = process.env.ICON_URL || `${normalizedBaseUrl}/assets/icon-64.png`;
const highIconUrl = process.env.HIGH_ICON_URL || `${normalizedBaseUrl}/assets/icon-128.png`;
const supportUrl = process.env.SUPPORT_URL || `${normalizedBaseUrl}/support/`;
const templateXml = fs.readFileSync(templatePath, "utf8");
const manifestXml = templateXml
  .replaceAll("__BASE_URL__", normalizedBaseUrl)
  .replaceAll("__APP_DOMAIN__", appDomain)
  .replaceAll("__ICON_URL__", iconUrl)
  .replaceAll("__HIGH_ICON_URL__", highIconUrl)
  .replaceAll("__SUPPORT_URL__", supportUrl);

fs.writeFileSync(outputPath, manifestXml, "utf8");
process.stdout.write(`Generated manifest: ${outputPath}\n`);
