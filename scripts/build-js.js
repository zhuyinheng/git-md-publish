#!/usr/bin/env node
// Produce the single-file JS release asset (dist/git-md-publish.js).
//
// install.sh prefers this asset when the host already has a working
// `node >= 20`. It's simply the CLI + deps bundled with esbuild, with a
// Node shebang so it can be invoked directly once marked executable.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleCli } from "./bundle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

async function main() {
  fs.mkdirSync(DIST, { recursive: true });
  // .cjs so Node always resolves this as CommonJS, independent of any
  // sibling package.json (e.g. when the user drops the file into an ESM
  // project directory).
  const outFile = path.join(DIST, "git-md-publish.cjs");
  await bundleCli({ outFile });
  fs.chmodSync(outFile, 0o755);
  process.stderr.write(`build: built ${outFile}\n`);
}

main().catch((err) => {
  console.error(`build-js failed: ${err.message}`);
  process.exit(1);
});
