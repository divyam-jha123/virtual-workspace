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

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  [key: string]: unknown;
}

/** A tool answer that shows art alongside its JSON envelope. */
export interface MediaPayload {
  data: Record<string, unknown>;
  images?: Array<{ mimeType: string; bytes: Uint8Array }>;
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
  return respondWithMedia(async () => ({ data: await run() }));
}

/**
 * Same envelope and same error path as `respond`, plus image blocks appended
 * after the text. The JSON stays first and stays complete, so a client that
 * ignores images loses nothing.
 */
export async function respondWithMedia(run: () => Promise<MediaPayload>): Promise<ToolResult> {
  try {
    const { data, images = [] } = await run();
    return {
      content: [
        { type: "text", text: asText({ ok: true, ...data }) },
        ...images.map((image) => ({
          type: "image" as const,
          data: Buffer.from(image.bytes).toString("base64"),
          mimeType: image.mimeType,
        })),
      ],
    };
  } catch (err) {
    return { content: [{ type: "text", text: asText(toEnvelope(err)) }], isError: true };
  }
}
