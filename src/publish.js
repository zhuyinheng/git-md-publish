// Publish: scan -> export -> sync, in one process.
//
// Equivalent to the pipeline:
//   git-md-publish scan <repoRoot> \
//     | git-md-publish export <repoRoot> \
//     | git-md-publish sync remote=<remote> branch=<branch>

import { scanRepo } from "./scan.js";
import { syncArchive } from "./sync.js";
import { gitCapture } from "./git.js";

async function gitArchive(repoRoot, paths) {
  const res = await gitCapture(
    ["archive", "--format=tar", "HEAD", "--", ...paths],
    { cwd: repoRoot },
  );
  if (res.code !== 0) {
    throw new Error(`git archive failed: ${res.stderr.toString("utf8").trim()}`);
  }
  return res.stdout;
}

export async function runPublish({ repoRoot, remote, branch, stderr }) {
  const { paths } = await scanRepo({
    repoRoot,
    warn: (msg) => stderr.write(`scan: ${msg}\n`),
  });
  if (paths.length === 0) {
    stderr.write("publish: scan produced no files\n");
    return 1;
  }
  const tarBytes = await gitArchive(repoRoot, paths);
  await syncArchive({
    tarBytes,
    remote,
    branch,
    warn: (msg) => stderr.write(`sync: ${msg}\n`),
  });
  return 0;
}
