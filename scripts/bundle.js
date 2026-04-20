// Shared esbuild bundle step.
//
// The SEA standalone build, the Node-based single-file JS release, and any
// future "run the CLI as one file" use case all want the same output:
// src/cli.js + its deps bundled to one CJS file with a Node shebang.

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export async function bundleCli({ outFile }) {
  const { build } = await import("esbuild");
  await build({
    entryPoints: [path.join(ROOT, "src", "cli.js")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: outFile,
    legalComments: "none",
    minify: false,
  });
  return outFile;
}

export { ROOT };
