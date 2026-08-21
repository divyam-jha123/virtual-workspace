import path from "node:path";
import { badRequest } from "./errors.js";

/**
 * Reduce any client- or archive-supplied name to a safe basename: no directory
 * component, no traversal, safe charset. Never trusts the input as a path.
 */
export function sanitizeFilename(reference: string): string {
  const base = path.basename(String(reference).split("\\").join("/"));
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  if (cleaned === "" || cleaned === "." || cleaned === "..") {
    throw badRequest("bad-filename", `Refusing unsafe filename "${reference}"`);
  }
  return cleaned;
}

/** Sanitize and require a specific extension (lowercased). */
export function sanitizePngName(reference: string): string {
  const name = sanitizeFilename(reference);
  if (!name.toLowerCase().endsWith(".png")) {
    throw badRequest("bad-filename", `Expected a .png filename, got "${reference}"`);
  }
  return name;
}
