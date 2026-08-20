import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MapMcpError } from "../errors.js";

/** Every directory a tool may read from, relative to the workspace root. */
export const WORKSPACE_DIRS = ["maps", "tilesets", "assets", "runtime", "schemas", ".map-mcp"] as const;

/** The subset a tool may write into. `schemas/` is published, never authored here. */
export const WRITABLE_DIRS = ["maps", "tilesets", "assets", "runtime", ".map-mcp"] as const;

export const ALLOWED_EXTENSIONS = [".tmj", ".tsj", ".json", ".png"] as const;

export type WorkspaceDir = (typeof WORKSPACE_DIRS)[number];

export interface ResolveOptions {
  /** Resolve for writing: restricts to WRITABLE_DIRS. */
  write?: boolean;
  /** Set false for directory ids, which carry no extension. */
  requireExtension?: boolean;
}

function invalid(id: string, why: string, fix: string): MapMcpError {
  return new MapMcpError("INVALID_PATH", `Rejected path "${id}": ${why}`, { rule: "path-jail", path: id, fix });
}

/**
 * The single filesystem gate. Nothing else in the server touches `fs` directly:
 * every path a tool receives is a workspace-relative id that lands here first.
 */
export class WorkspaceService {
  /** Lazily-resolved realpath of the root, so symlinked mounts still compare correctly. */
  private realRootPromise: Promise<string> | undefined;

  constructor(readonly root: string) {
    if (!path.isAbsolute(root)) throw new Error(`WorkspaceService root must be absolute, got "${root}"`);
  }

  /** Creates the standard workspace layout if it is missing. Idempotent. */
  async ensureLayout(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    for (const dir of WORKSPACE_DIRS) await fs.mkdir(path.join(this.root, dir), { recursive: true });
  }

  private async realRoot(): Promise<string> {
    this.realRootPromise ??= fs.realpath(this.root).catch(() => this.root);
    return this.realRootPromise;
  }

  /**
   * Turns a workspace-relative id into an absolute path, or throws.
   *
   * Rejects: absolute paths, `..`, `.`, empty or NUL-bearing segments, backslashes,
   * unknown top-level directories, disallowed extensions, and any id whose nearest
   * existing ancestor resolves (through symlinks) outside the root.
   */
  async resolve(id: string, options: ResolveOptions = {}): Promise<string> {
    const { write = false, requireExtension = true } = options;

    if (typeof id !== "string" || id.trim() === "") {
      throw invalid(String(id), "empty path", "Pass a workspace-relative id such as \"maps/hq.tmj\".");
    }
    if (id.includes("\0")) throw invalid(id, "NUL byte in path", "Remove control characters from the path.");
    if (id.includes("\\")) throw invalid(id, "backslashes are not path separators here", "Use forward slashes: \"maps/hq.tmj\".");
    if (path.isAbsolute(id) || /^[A-Za-z]:/.test(id)) {
      throw invalid(id, "absolute paths are not allowed", "Pass a path relative to the workspace root, e.g. \"maps/hq.tmj\".");
    }
    if (id.startsWith("~")) throw invalid(id, "home-relative paths are not allowed", "Use a workspace-relative id such as \"maps/hq.tmj\".");

    const segments = id.split("/");
    for (const segment of segments) {
      if (segment === "") throw invalid(id, "empty path segment", "Remove duplicate or trailing slashes.");
      if (segment === "." || segment === "..") {
        throw invalid(id, "relative segments (\".\"/\"..\") are not allowed", "Reference files directly, e.g. \"maps/hq.tmj\".");
      }
    }

    const top = segments[0]!;
    const allowed: readonly string[] = write ? WRITABLE_DIRS : WORKSPACE_DIRS;
    if (!allowed.includes(top)) {
      throw invalid(
        id,
        `"${top}" is not ${write ? "a writable" : "a readable"} workspace directory`,
        `Use one of: ${allowed.join(", ")}.`,
      );
    }
    if (segments.length < 2) {
      if (requireExtension) throw invalid(id, "a file id needs a name inside the directory", `Try "${top}/<name>.tmj".`);
    }

    if (requireExtension) {
      const ext = path.extname(id).toLowerCase();
      if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
        throw invalid(id, `extension "${ext || "(none)"}" is not allowed`, `Allowed extensions: ${ALLOWED_EXTENSIONS.join(", ")}.`);
      }
    }

    const root = await this.realRoot();
    const absolute = path.resolve(root, id);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw invalid(id, "path escapes the workspace root", "Keep every path inside the mounted workspace.");
    }

    await this.assertNoSymlinkEscape(id, absolute, root);
    return absolute;
  }

  /**
   * Walks up to the nearest existing ancestor and realpath-checks it. A symlink
   * anywhere along the chain that points outside the root fails here, including
   * the leaf itself when it already exists.
   */
  private async assertNoSymlinkEscape(id: string, absolute: string, root: string): Promise<void> {
    let current = absolute;
    for (;;) {
      try {
        const real = await fs.realpath(current);
        if (real !== root && !real.startsWith(root + path.sep)) {
          throw invalid(id, "path resolves outside the workspace through a symlink", "Replace the symlink with a real file inside the workspace.");
        }
        return;
      } catch (err) {
        if (err instanceof MapMcpError) throw err;
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        const parent = path.dirname(current);
        if (parent === current || parent.length < root.length) return;
        current = parent;
      }
    }
  }

  /** Absolute path -> workspace-relative id, for diagnostics. */
  relative(absolute: string): string {
    return path.relative(this.root, absolute).split(path.sep).join("/");
  }

  async exists(id: string, options: ResolveOptions = {}): Promise<boolean> {
    const absolute = await this.resolve(id, options);
    try {
      await fs.stat(absolute);
      return true;
    } catch {
      return false;
    }
  }

  async readText(id: string): Promise<string> {
    const absolute = await this.resolve(id);
    try {
      return await fs.readFile(absolute, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new MapMcpError("NOT_FOUND", `No such file: ${id}`, { path: id, fix: "List the directory first, or create the file." });
      }
      throw err;
    }
  }

  async readJson<T = unknown>(id: string): Promise<T> {
    const text = await this.readText(id);
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new MapMcpError("INVALID_MAP", `${id} is not valid JSON: ${(err as Error).message}`, {
        rule: "json-parse",
        path: id,
        fix: "Repair the file on the host, or recreate it with create_map.",
      });
    }
  }

  /** Write via tmp + rename in the same directory, so readers never see a partial file. */
  async writeText(id: string, contents: string): Promise<string> {
    const absolute = await this.resolve(id, { write: true });
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const tmp = `${absolute}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, contents, "utf8");
      await fs.rename(tmp, absolute);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    return absolute;
  }

  async writeBytes(id: string, contents: Uint8Array): Promise<string> {
    const absolute = await this.resolve(id, { write: true });
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const tmp = `${absolute}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, contents);
      await fs.rename(tmp, absolute);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    return absolute;
  }

  async writeJson(id: string, value: unknown): Promise<string> {
    return this.writeText(id, `${JSON.stringify(value, null, 2)}\n`);
  }

  /** Non-recursive listing of a workspace directory, returning workspace ids. */
  async list(dirId: string, options: { extensions?: readonly string[] } = {}): Promise<string[]> {
    const absolute = await this.resolve(dirId, { requireExtension: false });
    let entries: string[];
    try {
      entries = await fs.readdir(absolute);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const wanted = options.extensions?.map((e) => e.toLowerCase());
    return entries
      .filter((name) => !name.endsWith(".tmp"))
      .filter((name) => !wanted || wanted.includes(path.extname(name).toLowerCase()))
      .sort()
      .map((name) => `${dirId.replace(/\/$/, "")}/${name}`);
  }
}
