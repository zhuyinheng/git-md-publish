// Extract link / image / wikilink / embed targets from a Markdown body
// via a real Markdown AST.
//
// Stack (per dev_docs/design_scan.md §11.1):
//   * `remark-parse`       — CommonMark tokenizer → mdast
//   * `remark-gfm`         — tables, autolinks, strikethrough, etc.
//   * `@flowershow/remark-wiki-link` — Obsidian-style `[[...]]` / `![[...]]`
//
// AST traversal means code blocks, HTML blocks, inline code etc. are
// structurally distinct nodes — we don't need to pre-strip them to avoid
// false positives.

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import wikiLink from "@flowershow/remark-wiki-link";
import { visit } from "unist-util-visit";

const PROCESSOR = unified().use(remarkParse).use(remarkGfm).use(wikiLink);

function cleanTarget(target) {
  // Undo the syntactic wrapping that can appear around a link target:
  // angle brackets, fragment, query string, URL encoding.
  let t = String(target ?? "").trim();
  if (t.startsWith("<") && t.endsWith(">")) t = t.slice(1, -1);
  const hash = t.indexOf("#");
  if (hash >= 0) t = t.slice(0, hash);
  const q = t.indexOf("?");
  if (q >= 0) t = t.slice(0, q);
  try {
    t = decodeURIComponent(t);
  } catch {
    // Leave undecodable as-is; callers treat it as a plain string.
  }
  return t.trim();
}

function isExternal(target) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || target.startsWith("//");
}

export function extractReferences(markdown) {
  // Returns `[{ target }]` with every target normalised. Callers resolve
  // targets against the tracked tree; this module doesn't know about paths.
  const tree = PROCESSOR.parse(markdown);

  // First pass: collect definitions so reference-style links/images can
  // resolve their identifier → url.
  const defs = new Map();
  visit(tree, "definition", (node) => {
    if (node.identifier && node.url) {
      defs.set(node.identifier.toLowerCase(), node.url);
    }
  });

  const out = [];
  const pushIfInternal = (rawUrl) => {
    const cleaned = cleanTarget(rawUrl);
    if (!cleaned || isExternal(cleaned)) return;
    out.push({ target: cleaned });
  };

  visit(tree, (node) => {
    switch (node.type) {
      case "link":
      case "image":
        pushIfInternal(node.url);
        break;
      case "linkReference":
      case "imageReference": {
        const url = defs.get((node.identifier ?? "").toLowerCase());
        if (url) pushIfInternal(url);
        break;
      }
      case "wikiLink":
      case "embed": {
        // Obsidian-style links never carry a URL scheme, so no isExternal
        // check is needed — but we still strip the fragment / alias.
        const cleaned = cleanTarget(node.value);
        if (cleaned) out.push({ target: cleaned });
        break;
      }
    }
  });

  return out;
}
