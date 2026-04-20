#!/usr/bin/env node
// Build a standalone binary for the given (os, arch).
//
// Flow:
//   1. Bundle src/cli.js + its ESM deps into a single CJS file with esbuild.
//   2. Generate a Node SEA blob from that bundle (useCodeCache: false, so
//      the blob is architecture-agnostic).
//   3. Download the prebuilt node binary for the target (os, arch) from
//      nodejs.org, copy it, inject the SEA blob with postject.
//
// This lets a single Linux x64 runner produce binaries for all four
// release targets without a cross-compiler.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import https from "node:https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const CACHE = path.join(ROOT, ".cache");

const NODE_VERSION = process.env.GMP_NODE_VERSION ?? "v20.17.0";
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

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
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`download failed (${res.statusCode}): ${url}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    });
    req.on("error", reject);
  });
}

async function fetchNode(platformKey) {
  const { tarball, bin } = PLATFORM_MAP[platformKey];
  fs.mkdirSync(CACHE, { recursive: true });

  const tarPath = path.join(CACHE, tarball);
  if (!fs.existsSync(tarPath)) {
    await download(`https://nodejs.org/dist/${NODE_VERSION}/${tarball}`, tarPath);
  }

  const extractDir = path.join(CACHE, platformKey);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", tarPath, "-C", extractDir, "--strip-components=1"]);
  return path.join(extractDir, bin);
}

async function bundleCli() {
  // Produce a self-contained CJS bundle from the ESM CLI entry. SEA expects
  // a CommonJS-like main module, so we hand esbuild the ESM entry and ask
  // for a single cjs output.
  const { build } = await import("esbuild");
  const outFile = path.join(CACHE, "cli.bundle.cjs");
  await build({
    entryPoints: [path.join(ROOT, "src", "cli.js")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: outFile,
    legalComments: "none",
    minify: false,
  });
  return outFile;
}

function hostPlatformKey() {
  // Map Node's process.platform / process.arch to our PLATFORM_MAP key.
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}`;
}

async function buildOne(osName, archName) {
  const key = `${osName}-${archName}`;
  if (!PLATFORM_MAP[key]) throw new Error(`unsupported platform: ${key}`);

  fs.mkdirSync(DIST, { recursive: true });
  fs.mkdirSync(CACHE, { recursive: true });

  const bundlePath = await bundleCli();

  // SEA blob format is Node-version specific. Generate the blob with a
  // Node matching `NODE_VERSION` that can actually run on the host. Use
  // the host's platform key — otherwise cross-platform builds crash.
  const builderNode = await fetchNode(hostPlatformKey());
  const nodeBin = await fetchNode(key);

  // Architecture-agnostic SEA blob: no code cache, no startup snapshot.
  const seaConfigPath = path.join(CACHE, `sea-${key}.json`);
  const seaBlobPath = path.join(CACHE, `sea-${key}.blob`);
  fs.writeFileSync(
    seaConfigPath,
    JSON.stringify({
      main: bundlePath,
      output: seaBlobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    }),
  );

  log(`generating SEA blob for ${key} with ${builderNode}`);
  execFileSync(builderNode, ["--experimental-sea-config", seaConfigPath], {
    stdio: "inherit",
  });

  const outBin = path.join(DIST, `git-md-publish-${key}`);
  fs.copyFileSync(nodeBin, outBin);
  fs.chmodSync(outBin, 0o755);

  log(`injecting SEA blob into ${outBin}`);
  const postjectBin = path.join(ROOT, "node_modules", ".bin", "postject");
  // Mach-O binaries need an explicit segment name so postject places the
  // SEA blob in a standalone segment that survives macOS codesigning.
  const postjectArgs = [outBin, "NODE_SEA_BLOB", seaBlobPath, "--sentinel-fuse", SEA_FUSE];
  if (osName === "darwin") {
    postjectArgs.push("--macho-segment-name", "NODE_SEA");
  }
  execFileSync(postjectBin, postjectArgs, { stdio: "inherit" });

  // Re-sign darwin binaries: postject invalidates the pre-existing ad-hoc
  // signature that ships with the nodejs.org Mach-O. Without a valid
  // signature, macOS (especially arm64) will kill the process at exec.
  if (osName === "darwin") {
    log(`ad-hoc signing ${outBin}`);
    execFileSync("codesign", ["--sign", "-", "--force", outBin], {
      stdio: "inherit",
    });
  }

  log(`built ${outBin}`);
}

const [osName, archName] = process.argv.slice(2);
if (!osName || !archName) {
  console.error("usage: build.js <os> <arch>   (os ∈ linux|darwin; arch ∈ x64|arm64)");
  process.exit(2);
}

buildOne(osName, archName).catch((err) => {
  console.error(`build failed: ${err.message}`);
  process.exit(1);
});
