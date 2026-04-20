// Export tests. See dev_docs/design_export.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFixtureRepo, runCli, rmTmp } from "../helpers.js";
import { readArchive } from "../../src/tar.js";

test("export: tar contains exactly the requested files", async () => {
  const repo = makeFixtureRepo({
    "a.md": "alpha\n",
    "b.md": "beta\n",
    "c.md": "gamma\n",
  });
  try {
    const { code, stdout } = runCli(["export", repo], { stdin: "a.md\nc.md\n" });
    assert.equal(code, 0);
    const { entries } = await readArchive(stdout);
    const names = entries.map((e) => e.path).sort();
    assert.deepEqual(names, ["a.md", "c.md"]);
  } finally {
    await rmTmp(repo);
  }
});

test("export: duplicates and blanks are normalised", async () => {
  const repo = makeFixtureRepo({
    "a.md": "alpha\n",
    "b.md": "beta\n",
  });
  try {
    const { code, stdout } = runCli(["export", repo], {
      stdin: "\n a.md\nb.md\n\na.md\n",
    });
    assert.equal(code, 0);
    const { entries } = await readArchive(stdout);
    const names = entries.map((e) => e.path).sort();
    assert.deepEqual(names, ["a.md", "b.md"]);
  } finally {
    await rmTmp(repo);
  }
});

test("export: tar entry order is stable regardless of stdin order", async () => {
  const repo = makeFixtureRepo({
    "a.md": "alpha\n",
    "b.md": "beta\n",
    "c.md": "gamma\n",
  });
  try {
    const r1 = runCli(["export", repo], { stdin: "c.md\na.md\nb.md\n" });
    const r2 = runCli(["export", repo], { stdin: "a.md\nb.md\nc.md\n" });
    assert.equal(r1.code, 0);
    assert.equal(r2.code, 0);
    // git archive output is deterministic modulo mtime. The entry order
    // must be identical across the two runs.
    const n1 = (await readArchive(r1.stdout)).entries.map((e) => e.path);
    const n2 = (await readArchive(r2.stdout)).entries.map((e) => e.path);
    assert.deepEqual(n1, n2);
  } finally {
    await rmTmp(repo);
  }
});

test("export: missing path is an error", async () => {
  const repo = makeFixtureRepo({ "a.md": "alpha\n" });
  try {
    const { code, stderr } = runCli(["export", repo], { stdin: "missing.md\n" });
    assert.notEqual(code, 0);
    assert.match(stderr, /missing|does not exist|not found|not in the cache/i);
  } finally {
    await rmTmp(repo);
  }
});

test("export: empty path list fails cleanly", async () => {
  const repo = makeFixtureRepo({ "a.md": "alpha\n" });
  try {
    const { code, stderr } = runCli(["export", repo], { stdin: "\n\n" });
    assert.notEqual(code, 0);
    assert.match(stderr, /empty path list/);
  } finally {
    await rmTmp(repo);
  }
});
