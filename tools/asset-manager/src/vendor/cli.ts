import { config } from "../config.js";
import { createContext } from "../context.js";
import { prisma } from "../db.js";
import { vendor, assertVendorTarget } from "./vendor.js";

/** `pnpm vendor [key ...]` — push placeable tilesets + assets into content/. */
async function main(): Promise<void> {
  const keys = process.argv.slice(2).filter(Boolean);
  assertVendorTarget(keys.length ? keys : undefined);
  const ctx = createContext(config, prisma);
  const result = await vendor(ctx, keys.length ? { tilesetKeys: keys } : {});
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
