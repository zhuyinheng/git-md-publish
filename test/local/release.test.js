// Release tests for the local-producible portions of the release process.
// Actual GitHub Release creation / upload lives in test/remote/.
// See dev_docs/design_release.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkTmp, rmTmp } from "../helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

const EXPECTED_ASSETS = [
  "install.sh",
  "git-md-publish.cjs",
  "git-md-publish-darwin-arm64",
  "git-md-publish-darwin-x64",
  "git-md-publish-linux-arm64",
  "git-md-publish-linux-x64",
];

test("release: asset filenames match the design", () => {
  // The workflow uploads exactly these files. If the design list and the
  // workflow drift apart, we want a test to flag it.
  const workflow = fs.readFileSync(
    path.join(ROOT, ".github", "workflows", "release.yml"),
    "utf8",
  );
  for (const name of EXPECTED_ASSETS) {
    assert.ok(
      workflow.includes(name),
      `release workflow must reference asset ${name}`,
    );
  }
});

test("release: generated install.sh embeds the correct asset base URL", () => {
  const dir = mkTmp("gmp-release-");
  try {
    const outPath = path.join(dir, "install.sh");
    const r = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "scripts", "generate-install.js"),
        "v9.9.9",
        "acme/widget",
        outPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    const body = fs.readFileSync(outPath, "utf8");
    assert.match(body, /RELEASE_TAG="v9\.9\.9"/);
    assert.match(
      body,
      /ASSET_BASE_URL="https:\/\/github\.com\/acme\/widget\/releases\/download\/v9\.9\.9"/,
    );
    // And the resulting asset URL for Linux x64 must be well-formed.
    assert.match(
      body,
      /ASSET="\$\{BINARY_NAME\}-\$\{OS\}-\$\{ARCH\}"/,
    );
  } finally {
    rmTmp(dir);
  }
});

test("release: install.sh downloads without requiring npm, depends only on standard UNIX tools", () => {
  const dir = mkTmp("gmp-release-");
  try {
    const outPath = path.join(dir, "install.sh");
    spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "generate-install.js"), "v0.1.0", "o/r", outPath],
      { encoding: "utf8" },
    );
    const body = fs.readFileSync(outPath, "utf8");
    // install.sh MAY mention `node` now — it uses host node when
    // available to install the JS bundle channel. But it must never
    // need npm: we ship a single pre-bundled file.
    assert.doesNotMatch(body, /\bnpm\b/, "install.sh must not invoke npm");
    // Downloader toolchain is standard: curl or wget.
    assert.match(body, /command -v curl/);
    assert.match(body, /command -v wget/);
  } finally {
    rmTmp(dir);
  }
});
