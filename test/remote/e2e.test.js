// Remote end-to-end: clone the real obsidian_test_vault and publish it to
// obsidian_test_vault_live, then verify the target branch reflects the
// source HEAD. See dev_docs/design_tests.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkTmp, rmTmp, runCli } from "../helpers.js";

const LIVE_REMOTE = process.env.GMP_LIVE_REMOTE;
const LIVE_BRANCH = process.env.GMP_LIVE_BRANCH || "claude-live-e2e";
const SOURCE_VAULT =
  process.env.GMP_SOURCE_VAULT ||
  "https://github.com/zhuyinheng/obsidian_test_vault.git";

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr}`);
  }
  return r.stdout;
}

test(
  "remote: publish obsidian_test_vault → obsidian_test_vault_live end-to-end",
  { skip: !LIVE_REMOTE && "set GMP_LIVE_REMOTE to run" },
  async () => {
    const dir = mkTmp("gmp-remote-e2e-");
    try {
      sh("git", ["clone", "--depth=1", SOURCE_VAULT, path.join(dir, "src")]);
      const repoRoot = path.join(dir, "src");
      const sourceHead = sh("git", ["-C", repoRoot, "rev-parse", "HEAD"]).trim();

      const { code, stderr } = runCli([
        "publish",
        repoRoot,
        `remote=${LIVE_REMOTE}`,
        `branch=${LIVE_BRANCH}`,
      ]);
      assert.equal(code, 0, stderr);

      // Fetch the remote branch and verify the snapshot commit's message
      // references the source HEAD.
      const ref = sh("git", ["ls-remote", LIVE_REMOTE, `refs/heads/${LIVE_BRANCH}`]);
      assert.ok(ref.match(/^[0-9a-f]{40}/), "remote branch must exist after publish");

      const mirror = path.join(dir, "mirror");
      sh("git", ["clone", "--depth=1", "-b", LIVE_BRANCH, LIVE_REMOTE, mirror]);
      const msg = sh("git", ["-C", mirror, "log", "-1", "--format=%B"]).trim();
      assert.match(msg, new RegExp(`snapshot: src=${sourceHead}`));
    } finally {
      await rmTmp(dir);
    }
  },
);
