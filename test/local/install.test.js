// Install tests. Verify the installer script the release process ships.
// See dev_docs/design_install.md and dev_docs/design_release.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkTmp, rmTmp } from "../helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

function renderInstall(outPath, tag = "v0.0.0-test", repo = "owner/repo") {
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", "generate-install.js"), tag, repo, outPath],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`generate-install.js failed: ${r.stderr}`);
}

test("install: rendered install.sh carries releaseTag + asset base URL", async () => {
  const dir = mkTmp("gmp-install-");
  try {
    const outPath = path.join(dir, "install.sh");
    renderInstall(outPath, "v1.2.3", "foo/bar");
    const body = fs.readFileSync(outPath, "utf8");
    assert.match(body, /RELEASE_TAG="v1\.2\.3"/);
    assert.match(
      body,
      /ASSET_BASE_URL="https:\/\/github\.com\/foo\/bar\/releases\/download\/v1\.2\.3"/,
    );
    // Installed binary name must be exact.
    assert.match(body, /BINARY_NAME="git-md-publish"/);
    // Installer is marked executable.
    const stat = fs.statSync(outPath);
    assert.equal((stat.mode & 0o111) !== 0, true);
  } finally {
    await rmTmp(dir);
  }
});

test("install: install.sh selects OS/arch-specific asset name", async () => {
  const dir = mkTmp("gmp-install-");
  try {
    const outPath = path.join(dir, "install.sh");
    renderInstall(outPath);
    const body = fs.readFileSync(outPath, "utf8");
    // Branches for OS detection
    assert.match(body, /Darwin\) echo darwin/);
    assert.match(body, /Linux\) echo linux/);
    // Branches for arch detection
    assert.match(body, /arm64\|aarch64\) echo arm64/);
    assert.match(body, /x86_64\|amd64\) echo x64/);
    // Final asset filename
    assert.match(body, /ASSET="\$\{BINARY_NAME\}-\$\{OS\}-\$\{ARCH\}"/);
  } finally {
    await rmTmp(dir);
  }
});

test("install: binary install + PATH handling (offline dry run)", async () => {
  // Fully exercise the installer against a file:// URL and a writable HOME.
  // We stub the binary with a minimal shell script so there's no real
  // downloader dependency.
  const dir = mkTmp("gmp-install-");
  const home = path.join(dir, "home");
  const assetDir = path.join(dir, "assets");
  const installDir = path.join(home, ".local", "bin");
  await fsp.mkdir(installDir, { recursive: true });
  await fsp.mkdir(assetDir, { recursive: true });

  const uname = spawnSync("uname", ["-s"]).stdout.toString().trim();
  const osName = uname === "Darwin" ? "darwin" : "linux";
  const archRaw = spawnSync("uname", ["-m"]).stdout.toString().trim();
  const arch = /arm|aarch/i.test(archRaw) ? "arm64" : "x64";
  const assetName = `git-md-publish-${osName}-${arch}`;
  const assetPath = path.join(assetDir, assetName);
  await fsp.writeFile(assetPath, "#!/bin/sh\necho test-binary\n", { mode: 0o755 });

  try {
    const scriptPath = path.join(dir, "install.sh");
    renderInstall(scriptPath);
    // Rewrite the ASSET_BASE_URL to point at our local fixture so the
    // installer downloads from disk instead of GitHub.
    const fileUrl = `file://${assetDir}`;
    let body = fs.readFileSync(scriptPath, "utf8");
    body = body.replace(
      /ASSET_BASE_URL="[^"]*"/,
      `ASSET_BASE_URL="${fileUrl}"`,
    );
    fs.writeFileSync(scriptPath, body);

    // Empty rc file so the installer can append its PATH line.
    await fsp.writeFile(path.join(home, ".bashrc"), "");

    const r = spawnSync("sh", [scriptPath], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, SHELL: "/bin/bash", PATH: process.env.PATH },
    });
    assert.equal(r.status, 0, `installer failed: ${r.stderr}`);

    const installedBinary = path.join(installDir, "git-md-publish");
    assert.equal(fs.existsSync(installedBinary), true, "binary must be installed");
    const stat = fs.statSync(installedBinary);
    assert.equal((stat.mode & 0o111) !== 0, true, "binary must be executable");

    const rc = fs.readFileSync(path.join(home, ".bashrc"), "utf8");
    assert.match(rc, /export PATH="\$HOME\/\.local\/bin:\$PATH"/);
  } finally {
    await rmTmp(dir);
  }
});
