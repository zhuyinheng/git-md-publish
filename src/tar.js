// Pure JS tar reader for sync. Extracts:
//   * Global pax header → carries `git archive`'s sourceCommit.
//   * Payload entries   → file path, mode, mtime, content.
//
// We rely on `tar-stream` for per-entry parsing. `tar-stream` does not
// surface the pax global header as an event (it stores it internally), so
// we pre-scan the first tar block directly to recover the `comment` record
// that `git archive` writes there.

import { Readable } from "node:stream";
import tar from "tar-stream";
import { collectStream } from "./io.js";

const TAR_BLOCK = 512;

function readOctal(buf, offset, length) {
  // Tar numeric fields are NUL/space-terminated octal strings.
  const s = buf.slice(offset, offset + length).toString("ascii").replace(/[\0 ]+$/g, "");
  if (!s) return 0;
  return parseInt(s, 8);
}

function parsePaxRecords(buf) {
  // pax records have the form "<len> <key>=<value>\n" where <len> is the
  // total byte length of the record (including the length field itself).
  const out = {};
  const text = buf.toString("utf8");
  let i = 0;
  while (i < text.length) {
    const sp = text.indexOf(" ", i);
    if (sp < 0) break;
    const len = Number(text.slice(i, sp));
    if (!Number.isFinite(len) || len <= 0) break;
    const kv = text.slice(sp + 1, i + len - 1); // strip trailing newline
    const eq = kv.indexOf("=");
    if (eq > 0) out[kv.slice(0, eq)] = kv.slice(eq + 1);
    i += len;
  }
  return out;
}

function readGlobalPax(tarBytes) {
  // Returns the pax records from the leading global-pax header, or null if
  // the tar does not start with one.
  if (tarBytes.length < TAR_BLOCK) return null;
  const typeflag = tarBytes[156]; // 156..157 in the tar header
  if (typeflag !== 0x67 /* 'g' */) return null;
  const size = readOctal(tarBytes, 124, 12);
  const payload = tarBytes.slice(TAR_BLOCK, TAR_BLOCK + size);
  return parsePaxRecords(payload);
}

export async function readArchive(tarBytes) {
  // Returns { sourceCommit, mtime, entries } where:
  //   sourceCommit: string (40-char oid) read from pax global header.
  //   mtime:        Date shared by every payload entry (mtime in seconds).
  //   entries:      [{ path, mode, content }, ...] in tar order.
  // Throws if sourceCommit is missing or entries disagree on mtime.
  const pax = readGlobalPax(tarBytes);
  const sourceCommit = pax?.comment ?? null;

  const extract = tar.extract();
  const source = Readable.from([tarBytes]);
  source.pipe(extract);

  let mtime = null;
  const entries = [];

  for await (const entry of extract) {
    const header = entry.header;
    const content = await collectStream(entry);
    if (header.type !== "file") continue;

    const entryMtime = header.mtime instanceof Date ? header.mtime : new Date(header.mtime);
    if (mtime === null) {
      mtime = entryMtime;
    } else if (entryMtime.getTime() !== mtime.getTime()) {
      throw new Error(
        `tar payload has inconsistent mtimes: ${mtime.toISOString()} vs ${entryMtime.toISOString()} (${header.name})`,
      );
    }

    entries.push({
      path: header.name,
      mode: header.mode,
      content,
    });
  }

  if (!sourceCommit) {
    throw new Error("tar missing sourceCommit (pax global header)");
  }
  if (!mtime) {
    throw new Error("tar has no payload entries");
  }

  return { sourceCommit, mtime, entries };
}
