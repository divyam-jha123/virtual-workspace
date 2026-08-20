import path from "node:path";
import { registerSecret } from "./errors.js";

export type AssetSource = "local" | "api";
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export interface MapMcpConfig {
  /** Absolute path to the mounted workspace (the host's `content/`). */
  workspaceRoot: string;
  assetSource: AssetSource;
  assetApiUrl: string | undefined;
  assetApiKey: string | undefined;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MapMcpConfig {
  const workspaceRoot = path.resolve(env.MAP_MCP_WORKSPACE ?? path.join(process.cwd(), "content"));
  const assetApiKey = env.ASSET_API_KEY?.trim() || undefined;
  registerSecret(assetApiKey);

  const rawSource = env.ASSET_SOURCE?.trim().toLowerCase();
  const assetSource: AssetSource = rawSource === "api" ? "api" : "local";
  const rawLevel = env.MAP_MCP_LOG_LEVEL?.trim().toLowerCase() as LogLevel | undefined;

  return {
    workspaceRoot,
    assetSource,
    assetApiUrl: env.ASSET_API_URL?.trim() || undefined,
    assetApiKey,
    logLevel: rawLevel && LOG_LEVELS.includes(rawLevel) ? rawLevel : "warn",
    maxMapTiles: num(env.MAP_MCP_MAX_MAP_TILES, 1_000_000),
    offline: bool(env.MAP_MCP_OFFLINE, false),
  };
}
