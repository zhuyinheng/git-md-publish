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

test("install: install.sh selects OS/arch-specific asset name for Binary channel", async () => {
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
    // Final asset filename in Binary channel
    assert.match(body, /ASSET="\$\{BINARY_NAME\}-\$\{OS\}-\$\{ARCH\}"/);
  } finally {
    await rmTmp(dir);
  }
});

test("install: install.sh exposes both Node and Binary channels", async () => {
  const dir = mkTmp("gmp-install-");
  try {
    const outPath = path.join(dir, "install.sh");
    renderInstall(outPath);
    const body = fs.readFileSync(outPath, "utf8");
    assert.match(body, /install_node_channel\(\)/);
    assert.match(body, /install_binary_channel\(\)/);
    assert.match(body, /JS_ASSET="git-md-publish\.cjs"/);
    // Auto-selection predicate: node major >= 20 (sh syntax uses -ge).
    assert.match(body, /\$\{major\}.*-ge 20/);
    // Wrapper script template uses `exec node`.
    assert.match(body, /exec node /);
  } finally {
    await rmTmp(dir);
  }
});

function prepareInstallFixture(dir, assets) {
  // Build a renderable install.sh and a file:// asset directory. `assets`
  // is a map of asset-name → contents. Returns { scriptPath, home,
  // installDir, libDir }.
  const home = path.join(dir, "home");
  const assetDir = path.join(dir, "assets");
  const installDir = path.join(home, ".local", "bin");
  const libDir = path.join(home, ".local", "lib", "git-md-publish");
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(home, ".bashrc"), "");
  for (const [name, content] of Object.entries(assets)) {
    fs.writeFileSync(path.join(assetDir, name), content, { mode: 0o755 });
  }
  const scriptPath = path.join(dir, "install.sh");
  renderInstall(scriptPath);
  let body = fs.readFileSync(scriptPath, "utf8");
  body = body.replace(/ASSET_BASE_URL="[^"]*"/, `ASSET_BASE_URL="file://${assetDir}"`);
  fs.writeFileSync(scriptPath, body);
  return { scriptPath, home, installDir, libDir };
}

test("install: binary channel installs the standalone binary (forced)", async () => {
  const dir = mkTmp("gmp-install-");
  try {
    const osName = spawnSync("uname", ["-s"]).stdout.toString().trim() === "Darwin"
      ? "darwin" : "linux";
    const arch = /arm|aarch/i.test(
      spawnSync("uname", ["-m"]).stdout.toString().trim(),
    ) ? "arm64" : "x64";
    const assetName = `git-md-publish-${osName}-${arch}`;

    const { scriptPath, home, installDir } = prepareInstallFixture(dir, {
      [assetName]: "#!/bin/sh\necho test-binary\n",
    });

    const r = spawnSync("sh", [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        SHELL: "/bin/bash",
        GIT_MD_PUBLISH_CHANNEL: "binary",
      },
    });
    assert.equal(r.status, 0, `installer failed: ${r.stderr}`);

    const installedBinary = path.join(installDir, "git-md-publish");
    assert.equal(fs.existsSync(installedBinary), true);
    assert.equal((fs.statSync(installedBinary).mode & 0o111) !== 0, true);

    const rc = fs.readFileSync(path.join(home, ".bashrc"), "utf8");
    assert.match(rc, /export PATH="\$HOME\/\.local\/bin:\$PATH"/);
  } finally {
    await rmTmp(dir);
  }
});

test("install: node channel installs the JS bundle + wrapper (forced)", async () => {
  const dir = mkTmp("gmp-install-");
  try {
    const { scriptPath, home, installDir, libDir } = prepareInstallFixture(dir, {
      "git-md-publish.cjs": "#!/usr/bin/env node\nconsole.log('hi from js');\n",
    });

    const r = spawnSync("sh", [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        SHELL: "/bin/bash",
        GIT_MD_PUBLISH_CHANNEL: "node",
      },
    });
    assert.equal(r.status, 0, `installer failed: ${r.stderr}`);

    const jsPath = path.join(libDir, "git-md-publish.cjs");
    assert.equal(fs.existsSync(jsPath), true, "JS bundle must be installed");
    assert.equal((fs.statSync(jsPath).mode & 0o111) !== 0, true);

    const wrapper = path.join(installDir, "git-md-publish");
    assert.equal(fs.existsSync(wrapper), true, "wrapper script must be installed");
    const wrapperBody = fs.readFileSync(wrapper, "utf8");
    assert.match(wrapperBody, /^#!\/bin\/sh/);
    assert.match(wrapperBody, /exec node .*git-md-publish\.cjs/);
    assert.equal((fs.statSync(wrapper).mode & 0o111) !== 0, true);
  } finally {
    await rmTmp(dir);
  }
});

test("install: auto-picks node channel when node >= 20 is available", async () => {
  // The test process runs on the same host that builds the binaries; if
  // Node is ≥ 20 (true in every supported env), auto-mode must land on
  // the Node channel without explicit override.
  const dir = mkTmp("gmp-install-");
  try {
    const { scriptPath, home, installDir, libDir } = prepareInstallFixture(dir, {
      "git-md-publish.cjs": "#!/usr/bin/env node\nconsole.log('hi');\n",
    });
    const r = spawnSync("sh", [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        SHELL: "/bin/bash",
        // No GIT_MD_PUBLISH_CHANNEL override.
      },
    });
    assert.equal(r.status, 0, `installer failed: ${r.stderr}`);
    assert.equal(fs.existsSync(path.join(libDir, "git-md-publish.cjs")), true);
    const wrapper = fs.readFileSync(path.join(installDir, "git-md-publish"), "utf8");
    assert.match(wrapper, /exec node /);
  } finally {
    await rmTmp(dir);
  }
});
