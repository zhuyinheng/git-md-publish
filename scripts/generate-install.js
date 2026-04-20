#!/usr/bin/env node
// Render install/install.sh.tmpl with concrete releaseTag + asset base URL.
//
// Consumed by the release workflow (see .github/workflows/release.yml) and
// by local tests that need a fully materialised install.sh.
//
// Usage:
//   node scripts/generate-install.js <releaseTag> <ownerRepo> [outPath]
//
//     <ownerRepo> is "owner/repo" for GitHub.
//     <outPath>   defaults to dist/install.sh.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TMPL = path.join(ROOT, "install", "install.sh.tmpl");

function main() {
  const [releaseTag, ownerRepo, outArg] = process.argv.slice(2);
  if (!releaseTag || !ownerRepo) {
    console.error("usage: generate-install.js <releaseTag> <ownerRepo> [outPath]");
    process.exit(2);
  }
  const assetBase = `https://github.com/${ownerRepo}/releases/download/${releaseTag}`;
  const template = fs.readFileSync(TMPL, "utf8");
  const rendered = template
    .replaceAll("__RELEASE_TAG__", releaseTag)
    .replaceAll("__ASSET_BASE_URL__", assetBase);
  const out = outArg ?? path.join(ROOT, "dist", "install.sh");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, rendered, { mode: 0o755 });
  console.log(out);
}

main();
