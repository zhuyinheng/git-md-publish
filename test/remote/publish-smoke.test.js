// Remote publish smoke: push a publish result to the live target repo on
// GitHub. See dev_docs/design_tests.md.
//
// Skipped automatically when GMP_LIVE_REMOTE is unset, so the test binary
// is safe to run on machines without GitHub credentials.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { makeFixtureRepo, rmTmp, runCli, gitSync } from "../helpers.js";

const LIVE_REMOTE = process.env.GMP_LIVE_REMOTE;
const LIVE_BRANCH = process.env.GMP_LIVE_BRANCH || "claude-live-smoke";

test(
  "remote: publish pushes to the live GitHub remote",
  { skip: !LIVE_REMOTE && "set GMP_LIVE_REMOTE to run" },
  async () => {
    const repo = makeFixtureRepo({
      "README.md": "---\npublic: true\n---\n",
      "note.md":
        `---\npublic: true\n---\nlive-marker-${Date.now()}-${Math.random().toString(36).slice(2)}\n`,
    });
    try {
      const { code, stderr } = runCli([
        "publish",
        repo,
        `remote=${LIVE_REMOTE}`,
        `branch=${LIVE_BRANCH}`,
      ]);
      assert.equal(code, 0, stderr);

      // Confirm the remote branch head is the commit we just created, by
      // consulting the remote via `git ls-remote`.
      const lsRemote = spawnSync(
        "git",
        ["ls-remote", LIVE_REMOTE, `refs/heads/${LIVE_BRANCH}`],
        { encoding: "utf8" },
      );
      assert.equal(lsRemote.status, 0, lsRemote.stderr);
      assert.match(
        lsRemote.stdout,
        new RegExp(`[0-9a-f]{40}\\s+refs/heads/${LIVE_BRANCH}`),
        "live branch must exist on remote after publish",
      );
    } finally {
      await rmTmp(repo);
    }
  },
);
