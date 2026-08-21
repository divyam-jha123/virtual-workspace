import path from "node:path";
import yauzl from "yauzl";
import { badRequest, tooLarge } from "../lib/errors.js";

export interface ExtractedEntry {
  /** Sanitized, traversal-free relative path (forward slashes). */
  name: string;
  bytes: Uint8Array;
}

export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes?: number;
}

/**
 * Extract a ZIP fully in-memory with hard safety rules:
 *  - reject absolute paths, `..` traversal (zip-slip), and any entry that would
 *    resolve outside a virtual root,
 *  - reject symlink / non-regular entries (external attributes high bits),
 *  - cap entry count and cumulative uncompressed size,
 *  - never execute anything.
 */
export function extractZip(buffer: Buffer, limits: ZipLimits): Promise<ExtractedEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(badRequest("bad-zip", `Could not open ZIP: ${err?.message ?? "unknown"}`));
        return;
      }
      const out: ExtractedEntry[] = [];
      let total = 0;
      let count = 0;

      const fail = (e: Error) => {
        zip.close();
        reject(e);
      };

      zip.on("entry", (entry: yauzl.Entry) => {
        const raw = entry.fileName;
        // Directory entries end with '/': skip, they carry no bytes.
        if (raw.endsWith("/")) {
          zip.readEntry();
          return;
        }
        count += 1;
        if (count > limits.maxEntries) {
          fail(tooLarge(`ZIP has more than ${limits.maxEntries} entries.`));
          return;
        }

        // zip-slip / absolute / traversal guard.
        const normalized = raw.split("\\").join("/");
        if (path.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
          fail(badRequest("zip-slip", `ZIP entry "${raw}" uses an absolute path.`));
          return;
        }
        const parts = normalized.split("/").filter((p) => p !== "" && p !== ".");
        if (parts.some((p) => p === "..")) {
          fail(badRequest("zip-slip", `ZIP entry "${raw}" escapes the archive root.`));
          return;
        }
        // Symlink / special file: top 4 bits of the Unix mode in external attrs.
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        const fileType = unixMode & 0xf000;
        if (fileType === 0xa000 /* symlink */ || (fileType !== 0 && fileType !== 0x8000 /* regular */)) {
          fail(badRequest("zip-symlink", `ZIP entry "${raw}" is a symlink or special file.`));
          return;
        }

        const declared = entry.uncompressedSize;
        if (limits.maxEntryBytes && declared > limits.maxEntryBytes) {
          fail(tooLarge(`ZIP entry "${raw}" is ${declared} bytes, over the per-entry cap.`));
          return;
        }
        if (total + declared > limits.maxTotalBytes) {
          fail(tooLarge(`ZIP uncompressed size exceeds ${limits.maxTotalBytes} bytes.`));
          return;
        }

        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            fail(badRequest("bad-zip", `Could not read ZIP entry "${raw}".`));
            return;
          }
          const chunks: Buffer[] = [];
          let entryBytes = 0;
          stream.on("data", (chunk: Buffer) => {
            entryBytes += chunk.length;
            if (total + entryBytes > limits.maxTotalBytes) {
              stream.destroy();
              fail(tooLarge(`ZIP uncompressed size exceeds ${limits.maxTotalBytes} bytes.`));
              return;
            }
            chunks.push(chunk);
          });
          stream.on("end", () => {
            total += entryBytes;
            out.push({ name: parts.join("/"), bytes: new Uint8Array(Buffer.concat(chunks)) });
            zip.readEntry();
          });
          stream.on("error", () => fail(badRequest("bad-zip", `Error reading "${raw}".`)));
        });
      });

      zip.on("end", () => {
        zip.close();
        resolve(out);
      });
      zip.on("error", (e) => {
        // yauzl validates filenames itself and may reject traversal/absolute
        // names before we see the entry; classify those as zip-slip so the
        // reason is explicit rather than a generic archive error.
        const msg = e.message.toLowerCase();
        if (msg.includes("absolute path") || msg.includes("..") || msg.includes("invalid characters")) {
          fail(badRequest("zip-slip", e.message));
          return;
        }
        fail(badRequest("bad-zip", e.message));
      });
      zip.readEntry();
    });
  });
}
