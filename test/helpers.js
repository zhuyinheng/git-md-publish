// Shared helpers for local tests.
//
// Every helper here is deliberately dependency-free so tests stay
// straightforward to read.

import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const CLI = path.join(REPO_ROOT, "src", "cli.js");

// Give tests a self-contained git identity. `sync` fails by design when the
// host lacks `user.name` / `user.email`, so tests that exercise sync must
// guarantee identity. We redirect HOME to a disposable dir with a minimal
// gitconfig rather than mutating the caller's global config, which keeps
// tests reproducible on any machine (CI, fresh container, etc.).
{
  const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "gmp-test-home-"));
  fs.writeFileSync(
    path.join(testHome, ".gitconfig"),
    "[user]\n\tname = git-md-publish test\n\temail = test@example.com\n",
  );
  process.env.HOME = testHome;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
}

export function mkTmp(prefix = "gmp-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function rmTmp(dir) {
  if (!dir) return;
  await fsp.rm(dir, { recursive: true, force: true });
}

export function gitSync(args, { cwd, stdin } = {}) {
  // Synchronous git for test setup. Bypasses any host commit signing so test
  // fixtures commit reliably.
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    input: stdin,
    encoding: "buffer",
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr?.toString("utf8") ?? ""}`,
    );
  }
  return result.stdout;
}

export function writeFile(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

export function makeFixtureRepo(files) {
  // Create an initialised git repo containing `files` (map of rel path ->
  // string/buffer). Returns the repo path.
  const dir = mkTmp("gmp-fixture-");
  gitSync(["init", "-q", "-b", "main", dir]);
  gitSync(["config", "user.name", "Test"], { cwd: dir });
  gitSync(["config", "user.email", "test@example.com"], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    writeFile(dir, rel, content);
  }
  gitSync(["add", "-A"], { cwd: dir });
  gitSync(["commit", "-q", "-m", "fixture"], { cwd: dir });
  return dir;
}

export function runCli(args, { stdin, cwd } = {}) {
  // Run the CLI with the given argv as a separate Node process. Returns
  // { code, stdout, stderr } where stdout is a Buffer (tar can be binary).
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    input: stdin,
    // stdout as buffer so tar bytes survive round-trip
  });
  return {
    code: result.status,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8"),
  };
}

export function runPipeline(steps) {
  // Run `steps` (array of `{ argv, cwd }`) connected by pipes. Returns the
  // final stdout as a Buffer plus the concatenated stderr.
  if (steps.length === 0) throw new Error("runPipeline: no steps");
  return new Promise((resolve, reject) => {
    const children = steps.map((step, idx) =>
      spawn(process.execPath, [CLI, ...step.argv], {
        cwd: step.cwd,
        stdio: [idx === 0 ? "ignore" : "pipe", "pipe", "pipe"],
      }),
    );
    for (let i = 0; i < children.length - 1; i++) {
      children[i].stdout.pipe(children[i + 1].stdin);
    }
    const last = children[children.length - 1];
    const out = [];
    const err = [];
    for (const c of children) {
      c.stderr.on("data", (chunk) => err.push(chunk));
    }
    last.stdout.on("data", (chunk) => out.push(chunk));
    let closed = 0;
    let failed = null;
    for (const c of children) {
      c.on("error", reject);
      c.on("close", (code) => {
        if (code !== 0 && failed === null) failed = code;
        closed++;
        if (closed === children.length) {
          resolve({
            code: failed ?? 0,
            stdout: Buffer.concat(out),
            stderr: Buffer.concat(err).toString("utf8"),
          });
        }
      });
    }
  });
}
