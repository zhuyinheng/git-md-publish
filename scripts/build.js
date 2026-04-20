#!/usr/bin/env node
// Build a standalone binary for the given (os, arch).
//
// Strategy: download the matching prebuilt node for that platform, pack the
// project (src + node_modules) into a Node SEA blob, inject it. This keeps
// the build single-runner (no cross-compilers) and lets us produce all four
// release assets from one Linux x64 host.
//
// For the first iteration we defer to `node --experimental-sea-config`.
// The heavy lifting (downloading node tarballs, postject inject) is the same
// sequence `pkg` used to run; we keep it explicit so the release workflow can
// be audited line by line.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import https from "node:https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const NODE_VERSION = process.env.GMP_NODE_VERSION ?? "v20.17.0";

const PLATFORM_MAP = {
  "linux-x64": { tarball: `node-${NODE_VERSION}-linux-x64.tar.gz`, bin: "bin/node" },
  "linux-arm64": { tarball: `node-${NODE_VERSION}-linux-arm64.tar.gz`, bin: "bin/node" },
  "darwin-x64": { tarball: `node-${NODE_VERSION}-darwin-x64.tar.gz`, bin: "bin/node" },
  "darwin-arm64": { tarball: `node-${NODE_VERSION}-darwin-arm64.tar.gz`, bin: "bin/node" },
};

function log(msg) {
  process.stderr.write(`build: ${msg}\n`);
}

function download(url, dest) {
  log(`downloading ${url}`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`download failed (${res.statusCode}): ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

async function fetchNode(platformKey) {
  const { tarball, bin } = PLATFORM_MAP[platformKey];
  const cache = path.join(ROOT, ".cache", "node");
  fs.mkdirSync(cache, { recursive: true });

  const tarPath = path.join(cache, tarball);
  if (!fs.existsSync(tarPath)) {
    await download(`https://nodejs.org/dist/${NODE_VERSION}/${tarball}`, tarPath);
  }

  const extractDir = path.join(cache, platformKey);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execSync(`tar -xzf "${tarPath}" -C "${extractDir}" --strip-components=1`);
  return path.join(extractDir, bin);
}

async function build(osName, archName) {
  const key = `${osName}-${archName}`;
  if (!PLATFORM_MAP[key]) throw new Error(`unsupported platform: ${key}`);

  fs.mkdirSync(DIST, { recursive: true });

  const nodeBin = await fetchNode(key);
  const outBin = path.join(DIST, `git-md-publish-${key}`);

  // Generate SEA config and blob.
  const seaConfigPath = path.join(ROOT, ".cache", `sea-${key}.json`);
  const seaBlobPath = path.join(ROOT, ".cache", `sea-${key}.blob`);
  fs.writeFileSync(
    seaConfigPath,
    JSON.stringify({
      main: path.join(ROOT, "src", "cli.js"),
      output: seaBlobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: true,
    }),
  );

  log(`generating SEA blob for ${key}`);
  execSync(`node --experimental-sea-config "${seaConfigPath}"`, { stdio: "inherit" });

  fs.copyFileSync(nodeBin, outBin);
  fs.chmodSync(outBin, 0o755);

  log(`injecting SEA blob into ${outBin}`);
  execSync(
    `npx --yes postject "${outBin}" NODE_SEA_BLOB "${seaBlobPath}" ` +
      `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
    { stdio: "inherit" },
  );

  log(`built ${outBin}`);
}

const [osName, archName] = process.argv.slice(2);
if (!osName || !archName) {
  console.error("usage: build.js <os> <arch>   (os ∈ linux|darwin; arch ∈ x64|arm64)");
  process.exit(2);
}

build(osName, archName).catch((err) => {
  console.error(`build failed: ${err.message}`);
  process.exit(1);
});
