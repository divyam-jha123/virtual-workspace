import path from "node:path";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export interface MapMcpConfig {
  /** Absolute path to the mounted workspace (the host's `content/`). */
  workspaceRoot: string;
  logLevel: LogLevel;
  /** Hard cap on tiles in a single map, so a bad loop cannot fill the disk. */
  maxMapTiles: number;
}

const LOG_LEVELS: LogLevel[] = ["silent", "error", "warn", "info", "debug"];

function num(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MapMcpConfig {
  const workspaceRoot = path.resolve(env.MAP_MCP_WORKSPACE ?? path.join(process.cwd(), "content"));
  const rawLevel = env.MAP_MCP_LOG_LEVEL?.trim().toLowerCase() as LogLevel | undefined;

  return {
    workspaceRoot,
    logLevel: rawLevel && LOG_LEVELS.includes(rawLevel) ? rawLevel : "warn",
    maxMapTiles: num(env.MAP_MCP_MAX_MAP_TILES, 1_000_000),
  };
}
