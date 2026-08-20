#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { redact } from "./errors.js";
import { createServer } from "./server.js";

/**
 * stdio entry point.
 *
 * Transport wiring lives here and nowhere else, so adding Streamable HTTP later
 * is a change to this file alone. Nothing may write to stdout except the
 * protocol itself — diagnostics go to stderr, redacted.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { server } = await createServer(config);

  if (config.logLevel !== "silent") {
    process.stderr.write(
      `[map-mcp] workspace=${config.workspaceRoot} assetSource=${config.assetSource}${config.offline ? " (offline)" : ""}\n`,
    );
  }

  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  process.stderr.write(`[map-mcp] fatal: ${redact(err instanceof Error ? (err.stack ?? err.message) : String(err))}\n`);
  process.exit(1);
});
