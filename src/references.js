// Extract link / image / wikilink / embed targets from a Markdown body
// via a real Markdown AST.
//
// Stack (per dev_docs/design_scan.md §11.1):
//   * `remark-parse`       — CommonMark tokenizer → mdast
//   * `remark-gfm`         — tables, autolinks, strikethrough, etc.
//   * `@flowershow/remark-wiki-link` — Obsidian-style `[[...]]` / `![[...]]`
//   * `hast-util-from-html` — parse HTML nodes so we can follow refs in a
//                             bounded allowlist of tag/attr pairs.
//
// AST traversal means code blocks, HTML blocks, inline code etc. are
// structurally distinct nodes — we don't need to pre-strip them to avoid
// false positives.

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import wikiLink from "@flowershow/remark-wiki-link";
import { visit } from "unist-util-visit";
import { fromHtml } from "hast-util-from-html";

const PROCESSOR = unified().use(remarkParse).use(remarkGfm).use(wikiLink);

// Allowlist of HTML tag/attr pairs whose values we follow as references.
// Deliberately narrow: only "leaf" media and anchor links. iframe / object /
// embed are excluded because their payload is itself a document that may
// reference further files we don't recursively parse.
const HTML_REF_ATTRS = {
  a: ["href"],
  img: ["src"],
  video: ["src", "poster"],
  audio: ["src"],
  source: ["src"],
};

const UNSAFE_TAGS = new Set(["script", "style"]);
// hast-util-from-html camelCases HTML event handlers (`onclick` → `onClick`).
const EVENT_HANDLER_RE = /^on[A-Z]/;

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

function pushIfInternal(out, rawUrl) {
  const cleaned = cleanTarget(rawUrl);
  if (!cleaned || isExternal(cleaned)) return;
  out.push({ target: cleaned });
}

function walkHtmlFragment(rawHtml, references, unsafeHtml) {
  // Parse the raw HTML string with parse5 (via hast-util-from-html), then
  // walk the resulting hast tree. Malformed HTML is silently treated as
  // yielding no refs and no warnings — remark would have passed the text
  // through to the mirror unchanged anyway.
  let tree;
  try {
    tree = fromHtml(rawHtml, { fragment: true });
  } catch {
    return;
  }
  visit(tree, "element", (node) => {
    const tag = node.tagName;
    if (UNSAFE_TAGS.has(tag)) {
      unsafeHtml.push({ kind: tag, detail: `<${tag}>` });
    }
    const props = node.properties ?? {};
    for (const key of Object.keys(props)) {
      if (EVENT_HANDLER_RE.test(key)) {
        unsafeHtml.push({ kind: "event-handler", detail: `${key} on <${tag}>` });
      }
    }
    const attrs = HTML_REF_ATTRS[tag];
    if (!attrs) return;
    for (const attr of attrs) {
      const raw = props[attr];
      if (typeof raw !== "string") continue;
      pushIfInternal(references, raw);
    }
  });
}

export function extractReferences(markdown) {
  // Returns { references, unsafeHtml }:
  //   references: [{ target }] — target is normalised, internal only.
  //   unsafeHtml: [{ kind, detail }] — always reported; callers pipe to
  //               stderr so the author knows the mirror will contain raw
  //               <script>, <style>, or inline event handlers.
  const tree = PROCESSOR.parse(markdown);

  const defs = new Map();
  visit(tree, "definition", (node) => {
    if (node.identifier && node.url) {
      defs.set(node.identifier.toLowerCase(), node.url);
    }
  });

  const references = [];
  const unsafeHtml = [];

  visit(tree, (node) => {
    switch (node.type) {
      case "link":
      case "image":
        pushIfInternal(references, node.url);
        break;
      case "linkReference":
      case "imageReference": {
        const url = defs.get((node.identifier ?? "").toLowerCase());
        if (url) pushIfInternal(references, url);
        break;
      }
      case "wikiLink":
      case "embed": {
        // Obsidian-style targets never carry a URL scheme.
        const cleaned = cleanTarget(node.value);
        if (cleaned) references.push({ target: cleaned });
        break;
      }
      case "html":
        walkHtmlFragment(node.value, references, unsafeHtml);
        break;
    }
  });

  return { references, unsafeHtml };
}
