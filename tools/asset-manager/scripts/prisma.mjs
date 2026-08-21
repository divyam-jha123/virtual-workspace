#!/usr/bin/env node
/**
 * Thin wrapper around the Prisma CLI.
 *
 * `schema.prisma` declares `directUrl = env("DIRECT_DATABASE_URL")`, and Prisma
 * treats a missing value as a hard validation error (P1012) rather than falling
 * back. Against a plain local Postgres there is no pooler, so that second URL is
 * just the first one repeated — making people set it by hand only buys a
 * confusing error. This applies the same default `src/config.ts` does, then
 * hands off to Prisma unchanged.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_DATABASE_URL = "postgresql://asset_manager:asset_manager@localhost:5434/asset_manager?schema=public";

/** Minimal .env reader — Prisma loads this file itself; we only need to peek. */
function fromEnvFile(key) {
  const file = path.join(packageRoot, ".env");
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && match[1] === key) return match[2].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const env = { ...process.env };

/**
 * Resolve the migration URL.
 *
 * The order matters more than it looks. An explicit `DATABASE_URL` in the
 * environment means "operate on THIS database" — which is exactly how the test
 * suite targets its own database. If that case fell back to `.env` for the
 * direct URL, migrations would run against whatever `.env` names (production)
 * while queries went to the database you asked for. That is a test command
 * quietly migrating prod, so an explicit DATABASE_URL wins over the file.
 */
env.DIRECT_DATABASE_URL =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  fromEnvFile("DIRECT_DATABASE_URL") ??
  fromEnvFile("DATABASE_URL") ??
  LOCAL_DATABASE_URL;

const result = spawnSync("prisma", process.argv.slice(2), { stdio: "inherit", env, cwd: packageRoot, shell: false });
process.exit(result.status ?? 1);
