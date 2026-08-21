import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** tools/asset-manager/ regardless of whether we run from src/ or dist/. */
const packageRoot = path.resolve(here, "..");
/** Repo root: tools/asset-manager -> tools -> repo. */
const repoRoot = path.resolve(packageRoot, "..", "..");

export interface Config {
  port: number;
  /** Single static key guarding /v1. Sent by the MCP as Bearer AND X-API-Key. */
  apiKey: string;
  databaseUrl: string;
  /** Non-pooled connection, used by migrations. Same as `databaseUrl` locally. */
  directDatabaseUrl: string;
  /** Local object-store root (behind the Storage interface). */
  storageDir: string;
  /** The map-mcp workspace we vendor into: <repo>/content. */
  contentDir: string;
  /** Allowed browser origins for CORS (localhost only). */
  corsOrigins: string[];
  /** Where a person reaches the UI, used to build /pick/<token> links. */
  publicUrl: string;
  /** Hard caps for uploads. */
  maxUploadBytes: number;
  maxZipEntries: number;
  maxZipTotalBytes: number;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

const LOCAL_DATABASE_URL = "postgresql://asset_manager:asset_manager@localhost:5434/asset_manager?schema=public";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = int(env.PORT, 3300);
  const databaseUrl = env.DATABASE_URL ?? LOCAL_DATABASE_URL;
  return {
    port,
    apiKey: env.ASSET_MANAGER_API_KEY ?? "dev-key",
    databaseUrl,
    // Falls back to the pooled URL so a plain local Postgres needs no second
    // variable; on Neon the two genuinely differ and both must be set.
    directDatabaseUrl: env.DIRECT_DATABASE_URL ?? databaseUrl,
    storageDir: env.ASSET_MANAGER_STORAGE_DIR ?? path.join(packageRoot, "storage"),
    contentDir: env.MAP_MCP_CONTENT_DIR ?? path.join(repoRoot, "content"),
    publicUrl: env.ASSET_MANAGER_PUBLIC_URL ?? "http://localhost:3301",
    corsOrigins: (env.ASSET_MANAGER_CORS_ORIGINS ??
      "http://localhost:3301,http://127.0.0.1:3301,http://localhost:3300")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    maxUploadBytes: int(env.ASSET_MANAGER_MAX_UPLOAD_BYTES, 64 * 1024 * 1024),
    maxZipEntries: int(env.ASSET_MANAGER_MAX_ZIP_ENTRIES, 2000),
    maxZipTotalBytes: int(env.ASSET_MANAGER_MAX_ZIP_TOTAL_BYTES, 256 * 1024 * 1024),
  };
}

export const config = loadConfig();
export { packageRoot, repoRoot };
