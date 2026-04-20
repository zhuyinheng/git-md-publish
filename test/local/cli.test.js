// CLI tests. Verify the subcommand surface and the documented pipeline.
// See dev_docs/design_cli.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { makeFixtureRepo, mkTmp, rmTmp, runCli, runPipeline, gitSync } from "../helpers.js";

function gitText(args, opts) {
  return gitSync(args, opts).toString("utf8").trim();
}

test("cli: help is available", () => {
  const { code, stdout } = runCli(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout.toString("utf8"), /scan/);
  assert.match(stdout.toString("utf8"), /export/);
  assert.match(stdout.toString("utf8"), /sync/);
  assert.match(stdout.toString("utf8"), /publish/);
});

test("cli: unknown subcommand fails with non-zero exit", () => {
  const { code, stderr } = runCli(["frobnicate"]);
  assert.notEqual(code, 0);
  assert.match(stderr, /unknown subcommand/);
});

test("cli: missing remote for sync fails cleanly", () => {
  const { code, stderr } = runCli(["sync", "branch=main"]);
  assert.notEqual(code, 0);
  assert.match(stderr, /remote/);
});

test("cli: scan | export | sync pipeline ends up on the bare remote", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md": "---\npublic: true\n---\nhello\n",
    "img/fig.png": Buffer.from("PNG"),
  });
  const target = path.join(mkTmp("gmp-target-"), "bare");
  try {
    const { code } = await runPipeline([
      { argv: ["scan", repo] },
      { argv: ["export", repo] },
      { argv: ["sync", `remote=${target}`, "branch=main"] },
    ]);
    assert.equal(code, 0);
    const ls = gitText(["-C", target, "ls-tree", "-r", "--name-only", "main"]);
    assert.deepEqual(ls.split("\n").sort(), ["README.md", "note.md"]);
  } finally {
    await rmTmp(repo);
    await rmTmp(path.dirname(target));
  }
});

test("cli: publish is equivalent to the pipeline", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md": "---\npublic: true\n---\nhello\n",
  });
  const target = path.join(mkTmp("gmp-target-"), "bare");
  try {
    const { code } = runCli([
      "publish",
      repo,
      `remote=${target}`,
      "branch=main",
    ]);
    assert.equal(code, 0);
    const ls = gitText(["-C", target, "ls-tree", "-r", "--name-only", "main"]);
    assert.deepEqual(ls.split("\n").sort(), ["README.md", "note.md"]);
  } finally {
    await rmTmp(repo);
    await rmTmp(path.dirname(target));
  }
});

test("cli: publish and pipeline agree on commit oid", async () => {
  const repo = makeFixtureRepo({
    "README.md": "---\npublic: true\n---\n",
    "note.md": "---\npublic: true\n---\nhello\n",
  });
  const t1 = path.join(mkTmp("gmp-target-"), "bare");
  const t2 = path.join(mkTmp("gmp-target-"), "bare");
  try {
    runCli(["publish", repo, `remote=${t1}`, "branch=main"]);
    await runPipeline([
      { argv: ["scan", repo] },
      { argv: ["export", repo] },
      { argv: ["sync", `remote=${t2}`, "branch=main"] },
    ]);
    const h1 = gitText(["-C", t1, "rev-parse", "main"]);
    const h2 = gitText(["-C", t2, "rev-parse", "main"]);
    assert.equal(h1, h2);
  } finally {
    await rmTmp(repo);
    await rmTmp(path.dirname(t1));
    await rmTmp(path.dirname(t2));
  }
});
