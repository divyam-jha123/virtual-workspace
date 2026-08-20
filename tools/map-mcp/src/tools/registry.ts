import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MapMcpConfig } from "../config.js";
import { toEnvelope } from "../errors.js";
import type { AssetService } from "../services/assets/asset-service.js";
import type { MapService } from "../services/map-service.js";
import type { WorkspaceService } from "../services/workspace.js";

export interface ToolContext {
  config: MapMcpConfig;
  workspace: WorkspaceService;
  assets: AssetService;
  maps: MapService;
}

export type ToolModule = (server: McpServer, context: ToolContext) => void;

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

function asText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * Every tool answers with the same envelope: `{ ok: true, ... }` on success or
 * `{ ok: false, code, diagnostics: [{ ..., fix }] }` on failure. The `fix` hint is
 * the point — it is what lets the model correct itself instead of guessing.
 */
export async function respond(run: () => Promise<Record<string, unknown>>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: asText({ ok: true, ...(await run()) }) }] };
  } catch (err) {
    return { content: [{ type: "text", text: asText(toEnvelope(err)) }], isError: true };
  }
}
