// Extract and parse YAML frontmatter from Markdown.
//
// Uses `vfile-matter`, which parses `---`-delimited YAML frontmatter with
// the `yaml` package and strips it from the document body. Aligns with
// dev_docs/design_scan.md §7.

import { VFile } from "vfile";
import { matter } from "vfile-matter";

export function extractFrontmatter(markdown) {
  // Returns { data, body, error } where:
  //   data:  parsed YAML object, or null if no frontmatter / non-object body.
  //   body:  markdown body with the frontmatter stripped.
  //   error: YAML parse error, or null on success.
  const file = new VFile({ value: markdown });
  try {
    matter(file, { strip: true });
  } catch (error) {
    return { data: null, body: markdown, error };
  }
  const raw = file.data.matter;
  return {
    data: raw && typeof raw === "object" ? raw : null,
    body: String(file.value),
    error: null,
  };
}

export function readPublicFlag(data) {
  // Returns true / false only when `public` is an explicit boolean.
  // Any other shape (missing key, null, string, number, array, ...) falls
  // back to `undefined` so visibility inheritance keeps walking.
  if (!data) return undefined;
  if (typeof data.public === "boolean") return data.public;
  return undefined;
}
