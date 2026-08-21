import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { createServer } from "../src/server.js";
import { seedFixtureCatalog } from "./helpers/fixture-seed.js";

/**
 * Selection sessions over real HTTP.
 *
 * The rules that matter are the ones protecting an unauthenticated surface: the
 * pick page lives under /api, which has no login, so the token is the entire
 * capability and the candidate list is the entire allowlist.
 */
describe("selections", () => {
  let prisma: PrismaClient;
  let server: Server;
  let base: string;
  const key = "test-key";

  const v1 = (path: string, init?: RequestInit) =>
    fetch(`${base}/v1${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-api-key": key, ...(init?.headers ?? {}) },
    });
  const api = (path: string, init?: RequestInit) =>
    fetch(`${base}/api${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });

  async function newSelection(candidateIds: string[], ttlSeconds?: number): Promise<string> {
    const response = await v1("/selections", {
      method: "POST",
      body: JSON.stringify({ prompt: "pick a desk", candidateIds, ...(ttlSeconds ? { ttlSeconds } : {}) }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { token: string }).token;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await seedFixtureCatalog(prisma);
    const config = loadConfig({ ...process.env, ASSET_MANAGER_API_KEY: key });
    const app = createServer(createContext(config, prisma));
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.selection.deleteMany();
  });

  it("creates a pending selection and hands back a pick url", async () => {
    const response = await v1("/selections", {
      method: "POST",
      body: JSON.stringify({ prompt: "pick a desk", candidateIds: ["office.desk.pod4"] }),
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.status).toBe("pending");
    expect(body.chosenId).toBeNull();
    expect(String(body.token)).toMatch(/^[0-9a-f]{32}$/);
    expect(String(body.url)).toContain(`/pick/${body.token}`);
  });

  it("requires the api key on /v1 but not on the pick page", async () => {
    const token = await newSelection(["office.desk.pod4"]);

    const unauthorised = await fetch(`${base}/v1/selections/${token}`);
    expect(unauthorised.status).toBe(401);

    // The browser has no key — the token is what authorises it.
    expect((await api(`/selections/${token}`)).status).toBe(200);
  });

  it("serves candidates in the order they were offered", async () => {
    const ordered = ["office.desk.pod4", "office.chair.swivel"];
    const token = await newSelection(ordered);
    const body = (await (await api(`/selections/${token}`)).json()) as { candidates: Array<{ slug: string }> };
    expect(body.candidates.map((c) => c.slug)).toEqual(ordered);
  });

  it("refuses an asset that was never offered", async () => {
    const token = await newSelection(["office.desk.pod4"]);
    const response = await api(`/selections/${token}/choose`, {
      method: "POST",
      body: JSON.stringify({ assetId: "office.chair.swivel" }),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("not-a-candidate");

    // And the selection is untouched, not half-resolved.
    const after = (await (await v1(`/selections/${token}`)).json()) as { status: string; chosenId: null };
    expect(after).toMatchObject({ status: "pending", chosenId: null });
  });

  it("accepts one answer and refuses a second", async () => {
    const token = await newSelection(["office.desk.pod4", "office.chair.swivel"]);

    const first = await api(`/selections/${token}/choose`, {
      method: "POST",
      body: JSON.stringify({ assetId: "office.chair.swivel" }),
    });
    expect(first.status).toBe(200);
    expect((await first.json()) as { chosenId: string }).toMatchObject({ status: "chosen", chosenId: "office.chair.swivel" });

    const second = await api(`/selections/${token}/choose`, {
      method: "POST",
      body: JSON.stringify({ assetId: "office.desk.pod4" }),
    });
    expect(second.status).toBe(400);

    // The MCP's poll sees the first answer, not the second attempt.
    const polled = (await (await v1(`/selections/${token}`)).json()) as { chosenId: string };
    expect(polled.chosenId).toBe("office.chair.swivel");
  });

  it("expires on read once its deadline passes, and stops accepting answers", async () => {
    const token = await newSelection(["office.desk.pod4"]);
    // Reach past the API's 30s floor by ageing the row directly.
    await prisma.selection.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const status = (await (await v1(`/selections/${token}`)).json()) as { status: string };
    expect(status.status).toBe("expired");

    const late = await api(`/selections/${token}/choose`, {
      method: "POST",
      body: JSON.stringify({ assetId: "office.desk.pod4" }),
    });
    expect(late.status).toBe(400);
  });

  it("rejects an empty candidate list", async () => {
    const response = await v1("/selections", {
      method: "POST",
      body: JSON.stringify({ prompt: "pick something", candidateIds: [] }),
    });
    expect(response.status).toBe(400);
  });

  it("404s an unknown token rather than leaking whether one existed", async () => {
    expect((await v1("/selections/deadbeefdeadbeefdeadbeefdeadbeef")).status).toBe(404);
    expect((await api("/selections/deadbeefdeadbeefdeadbeefdeadbeef")).status).toBe(404);
  });
});
