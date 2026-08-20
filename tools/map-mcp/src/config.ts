import path from "node:path";
import { MapMcpError, registerSecret } from "./errors.js";

export type AssetSource = "local" | "api";
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export interface AssetApiSourceConfig {
  /** Distinct label used in status reports and diagnostics. */
  name: string;
  url: string;
  key: string | undefined;
}

export interface MapMcpConfig {
  /** Absolute path to the mounted workspace (the host's `content/`). */
  workspaceRoot: string;
  /** Legacy single-source switch: "api" activates ASSET_API_URL as one source when ASSET_APIS is not set. */
  assetSource: AssetSource;
  assetApiUrl: string | undefined;
  assetApiKey: string | undefined;
  /**
   * Zero or more remote sources, layered on top of the local catalog, first
   * entry wins a same-id collision. Populated from ASSET_APIS when set;
   * otherwise derived from the legacy ASSET_SOURCE/ASSET_API_URL pair.
   */
  assetApis: AssetApiSourceConfig[];
  logLevel: LogLevel;
  /** Hard cap on tiles in a single map, so a bad loop cannot fill the disk. */
  maxMapTiles: number;
  /** When true, no outbound request is ever attempted. */
  offline: boolean;
}

const LOG_LEVELS: LogLevel[] = ["silent", "error", "warn", "info", "debug"];

function num(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

/**
 * Parses `ASSET_APIS`, a JSON array of `{ name, url, key? }`, one entry per
 * remote source. Malformed config fails fast at startup with a fix hint, rather
 * than surfacing as a confusing runtime error the first time a tool is called.
 */
function parseAssetApis(raw: string | undefined): AssetApiSourceConfig[] {
  if (raw === undefined || raw.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new MapMcpError("INVALID_ARGUMENT", `ASSET_APIS is not valid JSON: ${(err as Error).message}`, {
      rule: "asset-apis-config",
      fix: 'ASSET_APIS must be a JSON array, e.g. \'[{"name":"vendorA","url":"https://...","key":"..."}]\'.',
    });
  }
  if (!Array.isArray(parsed)) {
    throw new MapMcpError("INVALID_ARGUMENT", "ASSET_APIS must be a JSON array", {
      rule: "asset-apis-config",
      fix: 'Wrap it in [ ], e.g. \'[{"name":"vendorA","url":"https://..."}]\'.',
    });
  }

  const sources: AssetApiSourceConfig[] = [];
  const names = new Set<string>();

  parsed.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new MapMcpError("INVALID_ARGUMENT", `ASSET_APIS[${index}] is not an object`, {
        rule: "asset-apis-config",
        fix: 'Each entry needs "name" and "url", e.g. {"name":"vendorA","url":"https://..."}.',
      });
    }
    const raw = entry as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const url = typeof raw.url === "string" ? raw.url.trim() : "";
    const key = typeof raw.key === "string" && raw.key.trim() !== "" ? raw.key.trim() : undefined;

    if (name === "") {
      throw new MapMcpError("INVALID_ARGUMENT", `ASSET_APIS[${index}] is missing "name"`, {
        rule: "asset-apis-config",
        fix: 'Give it a short label, e.g. "vendorA" — used in status reports and error messages.',
      });
    }
    if (name === "local") {
      throw new MapMcpError("INVALID_ARGUMENT", `ASSET_APIS[${index}] uses the reserved name "local"`, {
        rule: "asset-apis-config",
        fix: "Pick a different name; \"local\" always refers to content/assets/.",
      });
    }
    if (names.has(name)) {
      throw new MapMcpError("INVALID_ARGUMENT", `ASSET_APIS has two sources named "${name}"`, {
        rule: "asset-apis-config",
        fix: "Give every source a distinct name.",
      });
    }
    if (url === "") {
      throw new MapMcpError("INVALID_ARGUMENT", `ASSET_APIS[${index}] ("${name}") is missing "url"`, {
        rule: "asset-apis-config",
        fix: 'Set "url" to the source\'s base URL, e.g. "https://assets.example.com/v1".',
      });
    }

    names.add(name);
    sources.push({ name, url, key });
  });

  return sources;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MapMcpConfig {
  const workspaceRoot = path.resolve(env.MAP_MCP_WORKSPACE ?? path.join(process.cwd(), "content"));
  const assetApiKey = env.ASSET_API_KEY?.trim() || undefined;
  registerSecret(assetApiKey);

  const rawSource = env.ASSET_SOURCE?.trim().toLowerCase();
  const assetSource: AssetSource = rawSource === "api" ? "api" : "local";
  const assetApiUrl = env.ASSET_API_URL?.trim() || undefined;
  const rawLevel = env.MAP_MCP_LOG_LEVEL?.trim().toLowerCase() as LogLevel | undefined;

  const explicitApis = parseAssetApis(env.ASSET_APIS);
  for (const api of explicitApis) registerSecret(api.key);

  // ASSET_APIS is the multi-source mechanism and wins outright when set. The
  // legacy ASSET_SOURCE=api + ASSET_API_URL pair is kept only as a one-source
  // shorthand for setups that predate it.
  const assetApis = explicitApis.length > 0 ? explicitApis : assetSource === "api" && assetApiUrl ? [{ name: "api", url: assetApiUrl, key: assetApiKey }] : [];

  return {
    workspaceRoot,
    assetSource,
    assetApiUrl,
    assetApiKey,
    assetApis,
    logLevel: rawLevel && LOG_LEVELS.includes(rawLevel) ? rawLevel : "warn",
    maxMapTiles: num(env.MAP_MCP_MAX_MAP_TILES, 1_000_000),
    offline: bool(env.MAP_MCP_OFFLINE, false),
  };
}
