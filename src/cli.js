#!/usr/bin/env node
// CLI entry point. See dev_docs/design_cli.md.
//
// The CLI only parses arguments and wires stdin/stdout/stderr to the
// subcommand modules. All business logic lives next door.

import process from "node:process";
import { runScan } from "./scan.js";
import { runExport } from "./export.js";
import { runSync } from "./sync.js";
import { runPublish } from "./publish.js";

const USAGE = `Usage:
  git-md-publish scan    <repoRoot>
  git-md-publish export  <repoRoot>
  git-md-publish sync    remote=<remote> branch=<branch>
  git-md-publish publish <repoRoot> remote=<remote> branch=<branch>
`;

function parseKvArgs(args) {
  const positional = [];
  const kv = {};
  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq > 0) kv[arg.slice(0, eq)] = arg.slice(eq + 1);
    else positional.push(arg);
  }
  return { positional, kv };
}

function requireKey(kv, key) {
  if (!kv[key]) throw new Error(`missing required argument: ${key}=<value>`);
  return kv[key];
}

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  if (!subcommand || subcommand === "-h" || subcommand === "--help") {
    process.stdout.write(USAGE);
    return 0;
  }
  const { positional, kv } = parseKvArgs(rest);
  const { stdin, stdout, stderr } = process;

  switch (subcommand) {
    case "scan": {
      const [repoRoot] = positional;
      if (!repoRoot) throw new Error("scan requires <repoRoot>");
      return runScan({ repoRoot, stdout, stderr });
    }
    case "export": {
      const [repoRoot] = positional;
      if (!repoRoot) throw new Error("export requires <repoRoot>");
      return runExport({ repoRoot, stdin, stdout, stderr });
    }
    case "sync":
      return runSync({
        remote: requireKey(kv, "remote"),
        branch: requireKey(kv, "branch"),
        stdin,
        stdout,
        stderr,
      });
    case "publish": {
      const [repoRoot] = positional;
      if (!repoRoot) throw new Error("publish requires <repoRoot>");
      return runPublish({
        repoRoot,
        remote: requireKey(kv, "remote"),
        branch: requireKey(kv, "branch"),
        stderr,
      });
    }
    default:
      throw new Error(`unknown subcommand: ${subcommand}\n\n${USAGE}`);
  }
}

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    process.stderr.write(`git-md-publish: ${err.message ?? err}\n`);
    process.exit(1);
  },
);
