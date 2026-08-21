import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("resolves the workspace root to an absolute path", () => {
    const config = loadConfig({ MAP_MCP_WORKSPACE: "./content" } as NodeJS.ProcessEnv);
    expect(path.isAbsolute(config.workspaceRoot)).toBe(true);
    expect(config.workspaceRoot.endsWith(`${path.sep}content`)).toBe(true);
  });

  it("defaults the workspace root to <cwd>/content when unset", () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    expect(config.workspaceRoot).toBe(path.join(process.cwd(), "content"));
  });

  it("defaults the log level to warn and clamps unknown values", () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).logLevel).toBe("warn");
    expect(loadConfig({ MAP_MCP_LOG_LEVEL: "nonsense" } as NodeJS.ProcessEnv).logLevel).toBe("warn");
    expect(loadConfig({ MAP_MCP_LOG_LEVEL: "debug" } as NodeJS.ProcessEnv).logLevel).toBe("debug");
  });

  it("defaults maxMapTiles and honours a positive override", () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).maxMapTiles).toBe(1_000_000);
    expect(loadConfig({ MAP_MCP_MAX_MAP_TILES: "500" } as NodeJS.ProcessEnv).maxMapTiles).toBe(500);
    expect(loadConfig({ MAP_MCP_MAX_MAP_TILES: "-5" } as NodeJS.ProcessEnv).maxMapTiles).toBe(1_000_000);
  });
});
