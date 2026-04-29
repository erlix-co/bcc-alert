const path = require("node:path");
const https = require("node:https");
const express = require("express");
const devCerts = require("office-addin-dev-certs");

async function main() {
  const app = express();
  const port = 3000;
  const projectRoot = __dirname;

  app.use("/src", express.static(path.join(projectRoot, "src")));
  app.use("/assets", express.static(path.join(projectRoot, "assets")));
  app.get("/support", (_req, res) => {
    res.type("text/plain").send("BCC Alert Outlook add-in support endpoint.");
  });
  app.get("/", (_req, res) => {
    res.type("text/plain").send("BCC Alert Outlook runtime host is up.");
  });

  const httpsOptions = await devCerts.getHttpsServerOptions();
  https.createServer(httpsOptions, app).listen(port, () => {
    process.stdout.write(`HTTPS host started: https://localhost:${port}\n`);
    process.stdout.write(
      `Manifest path: ${path.join(projectRoot, "manifest.xml")}${"\n"}`
    );
  });
}

main().catch((error) => {
  process.stderr.write(`Failed to start HTTPS host: ${error?.message || error}\n`);
  process.exit(1);
});
