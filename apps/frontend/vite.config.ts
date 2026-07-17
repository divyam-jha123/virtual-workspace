import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Resolve the workspace packages to their TS source so Vite bundles them
// directly — no separate build step in dev, and HMR works across packages.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      protocol: fileURLToPath(new URL("../../packages/protocol/src/index.ts", import.meta.url)),
      "shared-types": fileURLToPath(new URL("../../packages/shared-types/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
