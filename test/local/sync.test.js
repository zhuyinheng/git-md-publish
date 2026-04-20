// Sync tests. See dev_docs/design_sync.md.
//
// Local sync tests use a filesystem bare repo as the remote. GitHub-remote
// behaviour lives in test/remote/.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { makeFixtureRepo, mkTmp, rmTmp, runCli, gitSync } from "../helpers.js";

function gitText(args, opts) {
  return gitSync(args, opts).toString("utf8").trim();
}

function exportTar(repo, paths) {
  const { code, stdout, stderr } = runCli(["export", repo], { stdin: paths.join("\n") + "\n" });
  if (code !== 0) throw new Error(`export failed: ${stderr}`);
  return stdout;
}

test("sync: creates a managed bare repo when the remote is missing", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md": "---\npublic: true\n---\nhello\n",
  });
  const target = path.join(mkTmp("gmp-target-"), "sub-target"); // non-existent
  try {
    const tar = exportTar(repo, ["README.md", "note.md"]);
    const { code, stderr } = runCli(
      ["sync", `remote=${target}`, "branch=main"],
      { stdin: tar },
    );
    assert.equal(code, 0, stderr);

    // Remote must now be a managed bare repo.
    assert.equal(gitText(["-C", target, "rev-parse", "--is-bare-repository"]), "true");
    assert.equal(
      gitText(["-C", target, "config", "--get", "git-md-publish.managed"]),
      "true",
    );
    assert.equal(
      gitText(["-C", target, "config", "--get", "git-md-publish.format"]),
      "sync-target-v1",
    );

    // Branch must point at a commit whose tree exactly matches the inputs.
    const tree = gitText(["-C", target, "ls-tree", "-r", "--name-only", "main"]);
    assert.deepEqual(tree.split("\n").sort(), ["README.md", "note.md"]);
  } finally {
    await rmTmp(repo);
    await rmTmp(path.dirname(target));
  }
});

test("sync: repeated sync to the same remote is idempotent", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md": "---\npublic: true\n---\nhello\n",
  });
  const target = path.join(mkTmp("gmp-target-"), "bare");
  try {
    const tar = exportTar(repo, ["README.md", "note.md"]);
    runCli(["sync", `remote=${target}`, "branch=main"], { stdin: tar });
    const head1 = gitText(["-C", target, "rev-parse", "main"]);
    runCli(["sync", `remote=${target}`, "branch=main"], { stdin: tar });
    const head2 = gitText(["-C", target, "rev-parse", "main"]);
    // Same inputs + same mtime + same sourceCommit → same commit oid.
    assert.equal(head1, head2);
  } finally {
    await rmTmp(repo);
    await rmTmp(path.dirname(target));
  }
});

test("sync: commit message carries sourceCommit and mtime", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md": "---\npublic: true\n---\nhi\n",
  });
  const target = path.join(mkTmp("gmp-target-"), "bare");
  try {
    const tar = exportTar(repo, ["README.md", "note.md"]);
    runCli(["sync", `remote=${target}`, "branch=main"], { stdin: tar });
    const msg = gitText(["-C", target, "log", "-1", "--format=%B", "main"]);
    assert.match(msg, /^snapshot: src=[0-9a-f]{40} mtime=/);
  } finally {
    await rmTmp(repo);
    await rmTmp(path.dirname(target));
  }
});

test("sync: rejects a pre-existing non-bare directory", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md": "---\npublic: true\n---\nhi\n",
  });
  const target = mkTmp("gmp-target-");
  try {
    // Put a random file in the target dir so it isn't empty and isn't a bare
    // repo.
    await fsp.writeFile(path.join(target, "unrelated.txt"), "hi");
    const tar = exportTar(repo, ["README.md", "note.md"]);
    const { code, stderr } = runCli(
      ["sync", `remote=${target}`, "branch=main"],
      { stdin: tar },
    );
    assert.notEqual(code, 0);
    assert.match(stderr, /not a managed bare repo/);
  } finally {
    await rmTmp(repo);
    await rmTmp(target);
  }
});

test("sync: reuses an existing managed bare repo", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md": "---\npublic: true\n---\nhi\n",
  });
  const target = path.join(mkTmp("gmp-target-"), "bare");
  try {
    const tar = exportTar(repo, ["README.md", "note.md"]);
    runCli(["sync", `remote=${target}`, "branch=main"], { stdin: tar }); // first sync initialises
    const fsEntriesBefore = fs.readdirSync(target).sort();
    const { code } = runCli(
      ["sync", `remote=${target}`, "branch=main"],
      { stdin: tar },
    );
    assert.equal(code, 0);
    const fsEntriesAfter = fs.readdirSync(target).sort();
    // Same bare repo structure, reused in place.
    assert.deepEqual(fsEntriesAfter, fsEntriesBefore);
  } finally {
    await rmTmp(repo);
    await rmTmp(path.dirname(target));
  }
});

test("sync: rejects tar without a pax global header", async () => {
  // Hand-craft a minimal tar that has one file but no global pax header.
  const { default: tar } = await import("tar-stream");
  const pack = tar.pack();
  pack.entry({ name: "note.md", mtime: new Date("2024-01-01T00:00:00Z") }, "hi");
  pack.finalize();
  const chunks = [];
  for await (const c of pack) chunks.push(c);
  const tarBytes = Buffer.concat(chunks);

  const target = path.join(mkTmp("gmp-target-"), "bare");
  try {
    const { code, stderr } = runCli(
      ["sync", `remote=${target}`, "branch=main"],
      { stdin: tarBytes },
    );
    assert.notEqual(code, 0);
    assert.match(stderr, /sourceCommit|pax global header/);
  } finally {
    await rmTmp(path.dirname(target));
  }
});
