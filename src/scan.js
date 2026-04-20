// Scan: given a git repo, list the public files to publish and any broken
// references found.
//
// See dev_docs/design_scan.md. Pipeline:
//   1. Enumerate HEAD's tree (skip gitlinks; symlinks are kept as-is).
//   2. Parse every markdown file's frontmatter. Record each file's own
//      `public` flag, and each README.md's `public` flag by directory.
//   3. For every public markdown, walk references:
//        - resolved markdown + public   → already collected; skip
//        - resolved markdown + private  → broken reference, reason "not-public"
//        - resolved non-markdown        → add to attachments
//        - unresolved                   → broken reference, reason "missing"
//   4. Emit the deduplicated path list in stable (sorted) order, plus any
//      warnings and broken references.

import path from "node:path/posix";
import { listTreeHead, readBlob } from "./git.js";
import { extractFrontmatter, readPublicFlag } from "./frontmatter.js";
import { extractReferences } from "./references.js";

const MARKDOWN_EXT = ".md";
const GITLINK_MODE = "160000";

function isMarkdown(p) {
  return p.toLowerCase().endsWith(MARKDOWN_EXT);
}

function repoDirname(filePath) {
  // POSIX dirname normalised so the repo root is "" (not ".").
  const dir = path.dirname(filePath);
  return dir === "." || dir === "/" ? "" : dir;
}

function dirChain(filePath) {
  // [file's dir, its parent, ..., ""] — the ancestor walk visibility uses.
  const chain = [];
  let dir = repoDirname(filePath);
  while (true) {
    chain.push(dir);
    if (dir === "") break;
    dir = repoDirname(dir);
  }
  return chain;
}

function joinRepoPath(dir, rel) {
  // A leading "/" on `rel` anchors at the repo root; otherwise it's relative
  // to `dir`.
  if (rel.startsWith("/")) return path.normalize(rel.slice(1));
  const joined = dir ? path.join(dir, rel) : rel;
  return path.normalize(joined);
}

function makeVisibilityResolver(readmeByDir) {
  return function resolve(filePath, selfPublic) {
    if (selfPublic !== undefined) return selfPublic;
    for (const dir of dirChain(filePath)) {
      const readme = readmeByDir.get(dir);
      if (!readme) continue;
      if (readme.publicFlag !== undefined) return readme.publicFlag;
    }
    return false;
  };
}

function resolveReferenceTarget({ fromFile, target, blobs, basenameIndex }) {
  const fromDir = repoDirname(fromFile);

  const candidate = joinRepoPath(fromDir, target);
  if (blobs.has(candidate)) return candidate;

  const hasExt = path.extname(candidate) !== "";
  if (!hasExt) {
    const asMd = candidate + MARKDOWN_EXT;
    if (blobs.has(asMd)) return asMd;
  }

  // Wikilinks frequently use a bare basename; fall back to the basename
  // index only if the target is a single segment.
  if (!candidate.includes("/")) {
    const byName = basenameIndex.get(candidate);
    if (byName) return byName;
    if (!hasExt) {
      const byMd = basenameIndex.get(candidate + MARKDOWN_EXT);
      if (byMd) return byMd;
    }
  }

  return undefined;
}

export async function scanRepo({ repoRoot, warn = () => {} }) {
  const entries = await listTreeHead(repoRoot);

  const warnings = [];
  const emit = (msg) => {
    warnings.push(msg);
    warn(msg);
  };

  // path -> { oid, mode, type }
  const blobs = new Map();
  const basenameIndex = new Map();
  const ambiguousBasenames = new Set();

  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    if (entry.mode === GITLINK_MODE) continue;
    // Symlinks stay in the map. Their blob content is the link target
    // string; `git archive` preserves the symlink on export. We never
    // dereference, so the presence or absence of the target is irrelevant.
    blobs.set(entry.path, entry);
    const base = path.basename(entry.path);
    if (ambiguousBasenames.has(base)) continue;
    if (basenameIndex.has(base)) {
      basenameIndex.delete(base);
      ambiguousBasenames.add(base);
    } else {
      basenameIndex.set(base, entry.path);
    }
  }

  // Read every markdown blob once, parse its frontmatter, remember its body
  // for the later reference walk.
  const fileSelfPublic = new Map();
  const readmeByDir = new Map();
  const markdownBody = new Map();

  await Promise.all(
    [...blobs.entries()]
      .filter(([p, entry]) => isMarkdown(p) && entry.mode !== "120000")
      .map(async ([filePath, { oid }]) => {
        const content = (await readBlob(repoRoot, oid)).toString("utf8");
        const { data, body, error } = extractFrontmatter(content);
        if (error) {
          emit(`failed to parse YAML frontmatter: ${filePath}: ${error.message}`);
        }
        const flag = readPublicFlag(data);
        fileSelfPublic.set(filePath, flag);
        markdownBody.set(filePath, body);
        if (path.basename(filePath).toLowerCase() === "readme.md") {
          readmeByDir.set(repoDirname(filePath), { publicFlag: flag });
        }
      }),
  );

  const resolveVisibility = makeVisibilityResolver(readmeByDir);

  const publicMarkdown = new Set();
  for (const [filePath, entry] of blobs) {
    if (!isMarkdown(filePath)) continue;
    if (entry.mode === "120000") continue; // symlink-as-markdown: never public on its own
    if (resolveVisibility(filePath, fileSelfPublic.get(filePath))) {
      publicMarkdown.add(filePath);
    }
  }

  const attachments = new Set();
  const brokenRefs = [];
  for (const filePath of publicMarkdown) {
    const body = markdownBody.get(filePath);
    for (const { target } of extractReferences(body)) {
      const resolved = resolveReferenceTarget({
        fromFile: filePath,
        target,
        blobs,
        basenameIndex,
      });
      if (!resolved) {
        brokenRefs.push({ from: filePath, target, reason: "missing" });
        continue;
      }
      if (isMarkdown(resolved)) {
        if (!publicMarkdown.has(resolved)) {
          brokenRefs.push({ from: filePath, target, reason: "not-public" });
        }
        // Public markdown is already in publicMarkdown; don't double-collect.
        continue;
      }
      attachments.add(resolved);
    }
  }

  for (const br of brokenRefs) {
    emit(`broken reference (${br.reason}): ${br.from} -> ${br.target}`);
  }

  const paths = [...new Set([...publicMarkdown, ...attachments])].sort();
  return { paths, warnings, brokenRefs };
}

export async function runScan({ repoRoot, stdout, stderr }) {
  const { paths } = await scanRepo({
    repoRoot,
    warn: (msg) => stderr.write(`scan: ${msg}\n`),
  });
  for (const p of paths) stdout.write(`${p}\n`);
  return 0;
}
