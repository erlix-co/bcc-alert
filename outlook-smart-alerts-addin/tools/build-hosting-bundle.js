"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const outputRoot = path.join(projectRoot, "hosting", "bcc-alert", "addin");

function copyTree(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(sourcePath, targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function copyDir(relativeSource, relativeTarget) {
  const source = path.join(projectRoot, relativeSource);
  const target = path.join(outputRoot, relativeTarget);
  copyTree(source, target);
}

fs.mkdirSync(outputRoot, { recursive: true });
for (const entry of fs.readdirSync(outputRoot)) {
  fs.rmSync(path.join(outputRoot, entry), { recursive: true, force: true });
}

copyDir("src", "src");
copyDir("assets", "assets");
copyDir("support", "support");

process.stdout.write(`Hosting bundle generated at: ${outputRoot}\n`);
