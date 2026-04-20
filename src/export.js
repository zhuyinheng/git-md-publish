// Export: read a path list from stdin, write an uncompressed tar to stdout.
//
// We defer to `git archive` rather than re-synthesising tar metadata. git
// archive pulls blobs straight from HEAD, so type / mode / content are
// already in the right shape.

import { spawn } from "node:child_process";
import { collectStream } from "./io.js";

export function normalisePathList(raw) {
  // Split the input, drop empty lines, de-duplicate, and sort so the tar
  // entry order is stable regardless of input order.
  const seen = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const p = line.trim();
    if (!p) continue;
    seen.add(p);
  }
  return [...seen].sort();
}

export async function runExport({ repoRoot, stdin, stdout, stderr }) {
  const rawInput = (await collectStream(stdin)).toString("utf8");
  const paths = normalisePathList(rawInput);

  if (paths.length === 0) {
    stderr.write("export: empty path list\n");
    return 1;
  }

  // `git archive HEAD <paths...>` emits an uncompressed tar with the same
  // entries that `git archive HEAD` would have emitted, filtered to `<paths>`.
  // A missing path causes git archive to fail with non-zero exit, satisfying
  // the "missing path is an error" contract.
  return await new Promise((resolve) => {
    const args = ["archive", "--format=tar", "HEAD", "--", ...paths];
    const child = spawn("git", args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(stdout, { end: false });
    child.stderr.on("data", (c) => stderr.write(c));
    child.on("error", (err) => {
      stderr.write(`export: failed to spawn git: ${err.message}\n`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}
