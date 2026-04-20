// Sync: consume a tar from stdin, produce a snapshot commit, push it to a
// remote branch. See dev_docs/design_sync.md.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readArchive } from "./tar.js";
import { gitCapture, gitText } from "./git.js";
import { collectStream } from "./io.js";

const MANAGED_MARKERS = {
  "git-md-publish.managed": "true",
  "git-md-publish.format": "sync-target-v1",
};
const MANAGED_KEY = "git-md-publish.managed";

async function mkdtempWork() {
  return fs.mkdtemp(path.join(os.tmpdir(), "git-md-publish-sync-"));
}

async function writeEntries(workTree, entries) {
  await Promise.all(
    entries.map(async (entry) => {
      const abs = path.join(workTree, entry.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, entry.content, { mode: entry.mode & 0o777 });
    }),
  );
}

async function hasConfiguredIdentity() {
  const [name, email] = await Promise.all([
    gitCapture(["config", "--get", "user.name"]),
    gitCapture(["config", "--get", "user.email"]),
  ]);
  return (
    name.code === 0 &&
    email.code === 0 &&
    name.stdout.toString().trim() !== "" &&
    email.stdout.toString().trim() !== ""
  );
}

function isUrlRemote(remote) {
  // Anything that looks like a URL or SCP-style path is a real remote; the
  // remaining case is a local filesystem path we manage ourselves. This is
  // intentionally POSIX-only — the release targets Linux and macOS.
  return (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(remote) || // scheme://
    /^[^/].*:/.test(remote) // SCP-style user@host:path
  );
}

async function initBareWithMarker(dir) {
  await gitText(["init", "--bare", dir]);
  for (const [key, value] of Object.entries(MANAGED_MARKERS)) {
    await gitText(["-C", dir, "config", key, value]);
  }
}

async function isManagedBareRepo(dir) {
  // Check "is a bare repo" + "carries our marker" with one spawn each.
  const bare = await gitCapture(["-C", dir, "rev-parse", "--is-bare-repository"]);
  if (bare.code !== 0 || bare.stdout.toString().trim() !== "true") return false;
  const marker = await gitCapture(["-C", dir, "config", "--get", MANAGED_KEY]);
  return marker.code === 0 && marker.stdout.toString().trim() === "true";
}

async function ensureLocalBareRemote(remote) {
  // Implements the local-folder remote rules from design_sync.md. Shape:
  //   non-existent       → mkdir + init --bare + write marker
  //   empty dir          → init --bare + write marker
  //   managed bare repo  → reuse
  //   anything else      → fail
  const abs = path.resolve(remote);
  let contents;
  try {
    contents = await fs.readdir(abs);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    await fs.mkdir(abs, { recursive: true });
    await initBareWithMarker(abs);
    return abs;
  }
  if (contents.length === 0) {
    await initBareWithMarker(abs);
    return abs;
  }
  if (!(await isManagedBareRepo(abs))) {
    throw new Error(`sync: local remote exists and is not a managed bare repo: ${remote}`);
  }
  return abs;
}

async function mustGit(args, opts, label) {
  const res = await gitCapture(args, opts);
  if (res.code !== 0) {
    throw new Error(`sync: ${label} failed: ${res.stderr.toString("utf8").trim()}`);
  }
  return res;
}

export async function syncArchive({ tarBytes, remote, branch, warn = () => {} }) {
  const { sourceCommit, mtime, entries } = await readArchive(tarBytes);

  if (entries.length === 0) {
    throw new Error("sync: tar has no payload entries");
  }
  if (!(await hasConfiguredIdentity())) {
    throw new Error("sync: host git is missing user.name or user.email");
  }

  const resolvedRemote = isUrlRemote(remote) ? remote : await ensureLocalBareRemote(remote);

  const workTree = await mkdtempWork();
  try {
    await writeEntries(workTree, entries);
    await gitText(["init", "-q", "-b", branch, workTree]);
    await gitText(["-C", workTree, "add", "-A"]);

    const isoDate = mtime.toISOString();
    const message = `snapshot: src=${sourceCommit} mtime=${isoDate}`;

    // Disable commit signing: the snapshot is a pure mirror of the tar, and
    // the host may have signing enabled globally.
    const env = {
      ...process.env,
      GIT_AUTHOR_DATE: isoDate,
      GIT_COMMITTER_DATE: isoDate,
    };
    await mustGit(
      [
        "-c",
        "commit.gpgsign=false",
        "-C",
        workTree,
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        message,
        "--date",
        isoDate,
      ],
      { env },
      "git commit",
    );

    await gitText(["-C", workTree, "remote", "add", "origin", resolvedRemote]);
    await mustGit(
      ["-C", workTree, "push", "--force", "origin", `HEAD:${branch}`],
      {},
      "git push",
    );
    warn(`synced ${entries.length} files to ${resolvedRemote} (${branch})`);
  } finally {
    await fs.rm(workTree, { recursive: true, force: true });
  }
}

export async function runSync({ remote, branch, stdin, stderr }) {
  const tarBytes = await collectStream(stdin);
  if (tarBytes.length === 0) {
    stderr.write("sync: empty tar on stdin\n");
    return 1;
  }
  await syncArchive({
    tarBytes,
    remote,
    branch,
    warn: (msg) => stderr.write(`sync: ${msg}\n`),
  });
  return 0;
}
