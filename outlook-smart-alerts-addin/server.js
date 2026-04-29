const path = require("node:path");
const https = require("node:https");
const express = require("express");
const devCerts = require("office-addin-dev-certs");

async function main() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const useDevHttps = process.env.USE_DEV_CERTS !== "false" && process.env.NODE_ENV !== "production";
  const projectRoot = __dirname;
  const metrics = {
    totalEvents: 0,
    decisions: {
      allowed: 0,
      blocked: 0
    },
    buckets: {
      "0-1": 0,
      "2-5": 0,
      "6+": 0
    }
  };

  app.use(express.json({ limit: "16kb" }));

  app.use("/src", express.static(path.join(projectRoot, "src")));
  app.use("/assets", express.static(path.join(projectRoot, "assets")));

  app.post("/api/metrics", (req, res) => {
    const decision = req.body?.decision;
    const bucket = req.body?.visibleRecipientBucket;

    if ((decision !== "allowed" && decision !== "blocked") || !(bucket in metrics.buckets)) {
      res.status(400).json({ ok: false, message: "Invalid metrics payload." });
      return;
    }

    metrics.totalEvents += 1;
    metrics.decisions[decision] += 1;
    metrics.buckets[bucket] += 1;

    res.status(202).json({ ok: true });
  });

  app.get("/api/metrics", (_req, res) => {
    res.json({
      ok: true,
      metrics
    });
  });

  app.get("/support", (_req, res) => {
    res.type("text/plain").send("BCC Alert Outlook add-in support endpoint.");
  });
  app.get("/", (_req, res) => {
    res.type("text/plain").send("BCC Alert Outlook runtime host is up.");
  });

  if (useDevHttps) {
    const httpsOptions = await devCerts.getHttpsServerOptions();
    https.createServer(httpsOptions, app).listen(port, () => {
      process.stdout.write(`HTTPS host started: https://localhost:${port}\n`);
      process.stdout.write(
        `Manifest path: ${path.join(projectRoot, "manifest.xml")}${"\n"}`
      );
    });
    return;
  }

  app.listen(port, () => {
    process.stdout.write(`HTTP host started on port ${port}\n`);
  });
}

main().catch((error) => {
  process.stderr.write(`Failed to start HTTPS host: ${error?.message || error}\n`);
  process.exit(1);
});
