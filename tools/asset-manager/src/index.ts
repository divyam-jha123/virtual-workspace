import { config } from "./config.js";
import { createContext } from "./context.js";
import { prisma } from "./db.js";
import { createServer } from "./server.js";

const ctx = createContext(config, prisma);
const app = createServer(ctx);

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[asset-manager] API on http://localhost:${config.port}  (/v1 key required, /api open to localhost)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
