// Extract link / image / wikilink / embed targets from a Markdown body.
//
// We do not build a full Markdown AST; we match the specific surface forms
// listed in dev_docs/design_scan.md on a body with code stripped. The
// matcher prefers false positives (a tracked file included unnecessarily)
// over false negatives (a public file silently losing an attachment).

const STANDARD_INLINE_RE = /!?\[[^\]\n]*?\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const REFERENCE_USE_RE = /!?\[[^\]\n]*?\]\[([^\]\n]+)\]/g;
const REFERENCE_DEF_RE = /^[ \t]{0,3}\[([^\]\n]+)\]:\s*(<[^>\n]*>|\S+)/gm;
const WIKILINK_RE = /!?\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g;
const CODE_FENCE_RE = /(^|\n)```[\s\S]*?\n```/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;

function stripCode(markdown) {
  return markdown.replace(CODE_FENCE_RE, "\n").replace(INLINE_CODE_RE, "");
}

function cleanTarget(target) {
  // Undo the syntactic wrapping that can appear around a link target:
  // angle brackets, fragment, query string, URL encoding.
  let t = target.trim();
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
  // targets against the tracked tree; this module doesn't need to know how.
  const body = stripCode(markdown);
  const out = [];

  // Build reference label → target map so [foo][bar] uses anywhere in the
  // doc resolve correctly.
  const refDefs = new Map();
  for (const m of body.matchAll(REFERENCE_DEF_RE)) {
    const label = m[1].trim().toLowerCase();
    const target = cleanTarget(m[2]);
    if (target) refDefs.set(label, target);
  }

  for (const m of body.matchAll(STANDARD_INLINE_RE)) {
    const target = cleanTarget(m[1]);
    if (target && !isExternal(target)) out.push({ target });
  }

  for (const m of body.matchAll(REFERENCE_USE_RE)) {
    const label = m[1].trim().toLowerCase();
    const target = refDefs.get(label);
    if (target && !isExternal(target)) out.push({ target });
  }

  for (const m of body.matchAll(WIKILINK_RE)) {
    const target = cleanTarget(m[1]);
    if (target) out.push({ target });
  }

  return out;
}
