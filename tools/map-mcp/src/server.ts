import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, type MapMcpConfig } from "./config.js";
import { AssetService } from "./services/assets/asset-service.js";
import { MapService } from "./services/map-service.js";
import { WorkspaceService } from "./services/workspace.js";
import { registerAssetTools } from "./tools/asset-tools.js";
import { registerMapTools } from "./tools/map-tools.js";
import { registerProjectTools } from "./tools/project-tools.js";
import type { ToolContext } from "./tools/registry.js";

export const SERVER_NAME = "map-mcp";
export const SERVER_VERSION = "0.0.1";

export interface BuiltServer {
  server: McpServer;
  context: ToolContext;
}

/**
 * Builds the server and everything under it. Transport-free on purpose: stdio is
 * wired in `index.ts`, and the in-memory transport the integration tests use
 * plugs into exactly the same object.
 */
export async function createServer(config: MapMcpConfig = loadConfig()): Promise<BuiltServer> {
  const workspace = new WorkspaceService(config.workspaceRoot);
  await workspace.ensureLayout();

  const assets = AssetService.fromConfig(config, workspace);
  const maps = new MapService(workspace, assets);
  const context: ToolContext = { config, workspace, assets, maps };

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        "Authoring tools for Tiled maps used by the Vorkium virtual office.\n\n" +
        "Start with get_project_info to learn the tile size, layer stack and object classes. Find art with search_assets, " +
        "then build with create_map / place_tiles / place_asset / add_object, and finish with save_map — which refuses to write " +
        "a map that still has errors. Every path is a workspace-relative id like \"maps/hq.tmj\". Maps are reviewed by opening " +
        "them in Tiled on the host; the game does not render them yet.",
    },
  );

  registerProjectTools(server, context);
  registerAssetTools(server, context);
  registerMapTools(server, context);

  return { server, context };
}
