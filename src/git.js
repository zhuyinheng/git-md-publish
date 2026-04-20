// Thin wrapper around the host `git` binary.
//
// We shell out to `git` rather than re-implementing its object model so the
// tool behaves exactly like the user's git on the same repo (same HEAD
// resolution, same path normalisation, same SSH / credential handling on
// push).

import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { collectStream } from "./io.js";

export function gitCapture(args, { cwd, stdin, env } = {}) {
  // Run `git <args>` and resolve with { stdout, stderr, code } regardless of
  // exit code. Buffers are used so binary stdout (e.g. tar blobs) survives.
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let errored = false;
    child.on("error", (err) => {
      errored = true;
      reject(err);
    });
    // Guard against EPIPE when the process ends before we finish writing.
    child.stdin.on("error", () => {});

    const stdoutPromise = collectStream(child.stdout);
    const stderrPromise = collectStream(child.stderr);

    child.on("close", async (code) => {
      if (errored) return;
      const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
      resolve({ stdout, stderr, code });
    });

    if (child.stdin.writable) {
      if (stdin !== undefined) child.stdin.end(stdin);
      else child.stdin.end();
    }
  });
}

export async function gitText(args, opts = {}) {
  const { stdout, stderr, code } = await gitCapture(args, opts);
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${code}: ${stderr.toString("utf8").trim()}`);
  }
  return stdout.toString("utf8");
}

export async function listTreeHead(repoRoot) {
  // Entries are `{ mode, type, oid, path }`. `-z` keeps paths with spaces or
  // unicode intact.
  const raw = await gitText(["ls-tree", "-r", "-z", "HEAD"], { cwd: repoRoot });
  if (!raw) return [];
  const entries = [];
  for (const rec of raw.split("\0")) {
    if (!rec) continue;
    // "<mode> <type> <oid>\t<path>"
    const tab = rec.indexOf("\t");
    const header = rec.slice(0, tab);
    const path = rec.slice(tab + 1);
    const [mode, type, oid] = header.split(" ");
    entries.push({ mode, type, oid, path });
  }
  return entries;
}

export async function readBlob(repoRoot, oid) {
  const { stdout, stderr, code } = await gitCapture(
    ["cat-file", "blob", oid],
    { cwd: repoRoot },
  );
  if (code !== 0) {
    throw new Error(`git cat-file ${oid} failed: ${stderr.toString("utf8").trim()}`);
  }
  return stdout;
}
