import path from "node:path";
import { isPng } from "../lib/png.js";

export type DetectedKind = "png" | "tsx" | "tsj" | "json" | "zip" | "unknown";

/** Decide what a file is from its extension corroborated by magic bytes. Never
 *  trusts the extension alone for binary formats. */
export function detectKind(filename: string, bytes: Uint8Array): DetectedKind {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return isPng(bytes) ? "png" : "unknown";
  if (ext === ".zip") return isZip(bytes) ? "zip" : "unknown";
  if (ext === ".tsx") return looksLikeXml(bytes) ? "tsx" : "unknown";
  if (ext === ".tsj" || ext === ".json") return looksLikeJson(bytes) ? (ext === ".tsj" ? "tsj" : "json") : "unknown";
  // Fall back to content sniffing.
  if (isPng(bytes)) return "png";
  if (isZip(bytes)) return "zip";
  if (looksLikeXml(bytes)) return "tsx";
  if (looksLikeJson(bytes)) return "json";
  return "unknown";
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

function looksLikeXml(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.slice(0, 64)).toString("utf8").trimStart();
  return head.startsWith("<?xml") || head.startsWith("<tileset");
}

function looksLikeJson(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.slice(0, 64)).toString("utf8").trimStart();
  return head.startsWith("{") || head.startsWith("[");
}
