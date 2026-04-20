// Scan tests. See dev_docs/design_scan.md and dev_docs/design_tests.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeFixtureRepo, runCli, rmTmp, gitSync } from "../helpers.js";

function parseLines(buf) {
  return buf.toString("utf8").split("\n").filter(Boolean);
}

test("scan: public frontmatter wins over inheritance", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: false\n---\n",
    "a.md": "---\npublic: true\n---\nhello\n",
    "b.md": "body only\n",
  });
  try {
    const { code, stdout } = runCli(["scan", repo]);
    assert.equal(code, 0);
    assert.deepEqual(parseLines(stdout), ["a.md"]);
  } finally {
    await rmTmp(repo);
  }
});

test("scan: inherits public flag from nearest README.md", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "pub/README.md": "---\npublic: true\n---\n",
    "pub/note.md": "hello\n",
    "priv/README.md": "---\npublic: false\n---\n",
    "priv/secret.md": "hi\n",
  });
  try {
    const { code, stdout } = runCli(["scan", repo]);
    assert.equal(code, 0);
    assert.deepEqual(parseLines(stdout), [
      "README.md",
      "pub/README.md",
      "pub/note.md",
    ]);
  } finally {
    await rmTmp(repo);
  }
});

test("scan: collects referenced attachments", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md":
      "---\npublic: true\n---\n" +
      "standard: ![alt](img/fig.png)\n" +
      "wiki: ![[diagram.png]]\n" +
      "ref: ![alt][x]\n\n[x]: img/ref.png\n",
    "img/fig.png": "png",
    "img/ref.png": "png",
    "diagram.png": "png",
  });
  try {
    const { code, stdout } = runCli(["scan", repo]);
    assert.equal(code, 0);
    assert.deepEqual(parseLines(stdout), [
      "README.md",
      "diagram.png",
      "img/fig.png",
      "img/ref.png",
      "note.md",
    ]);
  } finally {
    await rmTmp(repo);
  }
});

test("scan: external URLs are ignored for standard links", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md":
      "---\npublic: true\n---\n" +
      "[home](https://example.com)\n" +
      "![](//example.com/img.png)\n",
  });
  try {
    const { code, stdout } = runCli(["scan", repo]);
    assert.equal(code, 0);
    assert.deepEqual(parseLines(stdout), ["README.md", "note.md"]);
  } finally {
    await rmTmp(repo);
  }
});

test("scan: output order is stable (sorted)", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "z.md": "---\npublic: true\n---\n",
    "a.md": "---\npublic: true\n---\n",
    "m.md": "---\npublic: true\n---\n",
  });
  try {
    const { code, stdout } = runCli(["scan", repo]);
    assert.equal(code, 0);
    const got = parseLines(stdout);
    const sorted = [...got].sort();
    assert.deepEqual(got, sorted);
  } finally {
    await rmTmp(repo);
  }
});

test("scan: malformed YAML warns and treats file as unset", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: false\n---\n",
    "note.md": "---\npublic: [\n---\nbody\n",
  });
  try {
    const { code, stdout, stderr } = runCli(["scan", repo]);
    assert.equal(code, 0);
    assert.equal(parseLines(stdout).length, 0); // README false, note inherits false
    assert.match(stderr, /failed to parse YAML frontmatter/);
  } finally {
    await rmTmp(repo);
  }
});

test("scan: skips tracked symlinks with a warning", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "target.txt": "x",
  });
  try {
    fs.symlinkSync("target.txt", path.join(repo, "link.txt"));
    gitSync(["add", "link.txt"], { cwd: repo });
    gitSync(["commit", "-q", "-m", "add symlink"], { cwd: repo });

    const { code, stdout, stderr } = runCli(["scan", repo]);
    assert.equal(code, 0);
    assert.ok(!parseLines(stdout).includes("link.txt"), "symlink must not be listed");
    assert.match(stderr, /skipping tracked symlink/);
  } finally {
    await rmTmp(repo);
  }
});
