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

test("scan: preserves tracked symlinks (no warning, no dereference)", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md":
      "---\npublic: true\n---\n![fig](link.png)\n",
    "target.png": "PNG-BYTES",
  });
  try {
    // Tracked symlink pointing at an existing file in the repo.
    fs.symlinkSync("target.png", path.join(repo, "link.png"));
    gitSync(["add", "link.png"], { cwd: repo });
    gitSync(["commit", "-q", "-m", "add symlink"], { cwd: repo });

    const { code, stdout, stderr } = runCli(["scan", repo]);
    assert.equal(code, 0);
    // Symlink is referenced by a public markdown → must appear in output.
    assert.ok(
      parseLines(stdout).includes("link.png"),
      "referenced symlink must be listed",
    );
    assert.doesNotMatch(stderr, /skipping tracked symlink/);
    // Even though `target.png` is not referenced, `link.png` alone is fine.
    assert.doesNotMatch(stderr, /broken reference/);
  } finally {
    await rmTmp(repo);
  }
});

test("scan: symlink to a missing target is still listed", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md":
      "---\npublic: true\n---\n![fig](dangling.png)\n",
  });
  try {
    // Symlink whose on-disk target doesn't exist — git still tracks it.
    fs.symlinkSync("does-not-exist.png", path.join(repo, "dangling.png"));
    gitSync(["add", "dangling.png"], { cwd: repo });
    gitSync(["commit", "-q", "-m", "add dangling symlink"], { cwd: repo });

    const { code, stdout, stderr } = runCli(["scan", repo]);
    assert.equal(code, 0);
    assert.ok(parseLines(stdout).includes("dangling.png"));
    assert.doesNotMatch(stderr, /broken reference/);
  } finally {
    await rmTmp(repo);
  }
});

test("scan: reports broken reference for a missing target", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md":
      "---\npublic: true\n---\n![missing](img/nope.png)\n",
  });
  try {
    const { code, stdout, stderr } = runCli(["scan", repo]);
    assert.equal(code, 0);
    assert.deepEqual(parseLines(stdout), ["README.md", "note.md"]);
    assert.match(
      stderr,
      /broken reference \(missing\):\s+note\.md\s+->\s+img\/nope\.png/,
    );
  } finally {
    await rmTmp(repo);
  }
});

test("scan: reports broken reference when target markdown is not public", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md":
      "---\npublic: true\n---\n[link](secret.md)\n",
    "secret.md": "---\npublic: false\n---\ntop secret\n",
  });
  try {
    const { code, stdout, stderr } = runCli(["scan", repo]);
    assert.equal(code, 0);
    // secret.md must NOT be dragged in.
    assert.ok(!parseLines(stdout).includes("secret.md"));
    assert.match(
      stderr,
      /broken reference \(not-public\):\s+note\.md\s+->\s+secret\.md/,
    );
  } finally {
    await rmTmp(repo);
  }
});

test("scan: links inside fenced code blocks are not followed", async () => {
  // remark AST gives code blocks their own node type; references inside
  // must not be extracted as real references (no broken ref, no include).
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md":
      "---\npublic: true\n---\n\n" +
      "```md\n" +
      "[[in-code-block]]\n" +
      "![fake](not-real.png)\n" +
      "```\n" +
      "Inline: `[[inline-code-link]]`\n",
  });
  try {
    const { code, stdout, stderr } = runCli(["scan", repo]);
    assert.equal(code, 0);
    assert.deepEqual(parseLines(stdout), ["README.md", "note.md"]);
    assert.doesNotMatch(stderr, /broken reference/);
  } finally {
    await rmTmp(repo);
  }
});
