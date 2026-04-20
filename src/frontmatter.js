// Extract and parse YAML frontmatter from Markdown.
//
// A frontmatter block is a YAML document delimited by `---` lines that starts
// on the very first line of the file.

import yaml from "js-yaml";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function extractFrontmatter(markdown) {
  // Returns { data, body, raw } where:
  //   data: parsed YAML (object) or null if no frontmatter
  //   body: markdown body with the frontmatter stripped
  //   raw:  the raw YAML text (useful for diagnostics)
  // If YAML parsing fails, `data` is null and `error` carries the YAML error.
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) {
    return { data: null, body: markdown, raw: null, error: null };
  }
  const raw = match[1];
  const body = markdown.slice(match[0].length);
  try {
    const data = yaml.load(raw);
    // yaml.load returns undefined for empty docs; normalize to null.
    return {
      data: data && typeof data === "object" ? data : null,
      body,
      raw,
      error: null,
    };
  } catch (error) {
    return { data: null, body, raw, error };
  }
}

export function readPublicFlag(data) {
  // Returns true / false if explicitly set, undefined otherwise.
  // Only a real boolean terminates the inheritance walk.
  if (!data) return undefined;
  if (typeof data.public === "boolean") return data.public;
  return undefined;
}
