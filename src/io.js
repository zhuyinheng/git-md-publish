// Shared stream helpers.

import { Buffer } from "node:buffer";

export async function collectStream(stream) {
  // Drain an async-iterable / readable stream into a single Buffer.
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
