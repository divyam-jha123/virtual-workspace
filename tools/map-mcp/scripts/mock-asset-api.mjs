#!/usr/bin/env node
/**
 * A real HTTP server speaking the asset-API contract in `asset-api-dto.ts`.
 *
 * This exists because no public asset library exposes that contract, and testing
 * `HttpAssetRepository` against an in-process stub leaves the parts that actually
 * break in production untested: real sockets, real auth headers, real ETag
 * revalidation, real content-type and PNG checks.
 *
 * It serves the generated placeholder tileset under a DIFFERENT id than the local
 * catalog uses, so a run with both sources configured proves the merge rather than
 * quietly returning the same thing twice.
 *
 *   node tools/map-mcp/scripts/mock-asset-api.mjs            # port 8787, key "dev-key"
 *   PORT=9000 ASSET_API_KEY=hunter2 node .../mock-asset-api.mjs
 *
 * Then point the MCP at it:
 *   ASSET_APIS='[{"name":"mock","url":"http://localhost:8787/v1","key":"dev-key"}]'
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 8787);
const KEY = process.env.ASSET_API_KEY ?? "dev-key";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TILESETS = path.join(root, "content", "tilesets");

const TILESET_ID = "mock-office";
const SOURCE_PNG = path.join(TILESETS, "placeholder-office.png");

if (!fs.existsSync(SOURCE_PNG)) {
  console.error(`Missing ${SOURCE_PNG}\nRun: node tools/map-mcp/scripts/make-placeholder-tileset.mjs`);
  process.exit(1);
}

const atlas = fs.readFileSync(SOURCE_PNG);
const atlasName = `${TILESET_ID}.png`;

const tilesetJson = {
  columns: 8, image: atlasName, imageheight: 256, imagewidth: 256, margin: 0,
  name: TILESET_ID, spacing: 0, tilecount: 64, tiledversion: "1.11.0",
  tileheight: 32, tilewidth: 32, type: "tileset", version: "1.10",
};

const asset = (id, name, category, tags, tileId, w, h, extra = {}) => ({
  id, name, category, tags, style: "mock", tileSize: 32,
  dimensions: { width: w, height: h }, placement: "floor",
  tilesetId: TILESET_ID, tileId, version: "2", ...extra,
});

// Ids are distinct from the local catalog's "ph.*" so a combined run proves the
// merge; "ph.desk" is duplicated on purpose to demonstrate local winning.
const CATALOG = [
  asset("mock.desk", "Mock desk", "furniture", ["desk", "workstation"], 8, 2, 1,
    { collision: { blocking: true }, interaction: { class: "workstation", capacity: 2 } }),
  asset("mock.chair", "Mock chair", "furniture", ["chair", "seat"], 9, 1, 1, { collision: { blocking: false } }),
  asset("mock.plant", "Mock plant", "decoration", ["plant"], 10, 1, 1, { collision: { blocking: true } }),
  asset("mock.sofa", "Mock sofa", "furniture", ["sofa", "couch"], 11, 2, 1, { collision: { blocking: true } }),
  asset("mock.bookshelf", "Mock bookshelf", "furniture", ["bookshelf"], 15, 1, 1, { collision: { blocking: true } }),
  asset("ph.desk", "Mock's rival desk (local should win this id)", "furniture", ["desk"], 14, 2, 2,
    { collision: { blocking: true } }),
];

const etagFor = (body) => `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(status === 304 ? undefined : body);
}

function sendJson(req, res, payload) {
  const body = JSON.stringify(payload);
  const etag = etagFor(body);
  if (req.headers["if-none-match"] === etag) {
    console.log(`  -> 304 Not Modified (ETag matched)`);
    return send(res, 304, null, { etag });
  }
  send(res, 200, body, { "content-type": "application/json", etag });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  console.log(`${req.method} ${url.pathname}${url.search}`);

  // Auth exactly as the client sends it: Authorization bearer and/or X-API-Key.
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const apiKey = req.headers["x-api-key"] ?? "";
  if (bearer !== KEY && apiKey !== KEY) {
    console.log("  -> 401 (bad or missing key)");
    return send(res, 401, JSON.stringify({ error: "unauthorized" }), { "content-type": "application/json" });
  }

  const p = url.pathname.replace(/^\/v1/, "");

  if (p === "/tilesets") {
    return sendJson(req, res, { items: [{ id: TILESET_ID, name: "Mock Office", version: "2", tileSize: 32 }] });
  }
  if (p === `/tilesets/${TILESET_ID}.tsj`) {
    return sendJson(req, res, tilesetJson);
  }
  if (p === `/tilesets/${TILESET_ID}/${atlasName}`) {
    console.log(`  -> 200 atlas (${atlas.length} bytes)`);
    return send(res, 200, atlas, { "content-type": "image/png", "content-length": String(atlas.length) });
  }
  if (p.startsWith("/assets/")) {
    const id = decodeURIComponent(p.slice("/assets/".length));
    const found = CATALOG.find((a) => a.id === id);
    return found ? sendJson(req, res, { asset: found }) : send(res, 404, JSON.stringify({ error: "not found" }), { "content-type": "application/json" });
  }
  if (p === "/assets") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const category = url.searchParams.get("category");
    const style = url.searchParams.get("style");
    const tileSize = url.searchParams.get("tileSize");
    // `q` is whitespace-separated, synonym-expanded terms, matched as OR.
    const terms = q.split(/\s+/).filter(Boolean);
    const items = CATALOG.filter((a) => {
      if (category && a.category !== category) return false;
      if (style && a.style !== style) return false;
      if (tileSize && a.tileSize !== Number(tileSize)) return false;
      if (terms.length === 0) return true;
      const text = `${a.id} ${a.name} ${a.tags.join(" ")}`.toLowerCase();
      return terms.some((t) => text.includes(t));
    });
    console.log(`  -> 200 ${items.length} asset(s)`);
    return sendJson(req, res, { items, total: items.length });
  }

  send(res, 404, JSON.stringify({ error: "no such endpoint" }), { "content-type": "application/json" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock asset API on http://localhost:${PORT}/v1   (key: ${KEY})`);
  console.log(`  ${CATALOG.length} assets, tileset "${TILESET_ID}"\n`);
  console.log(`Point the MCP at it:`);
  console.log(`  ASSET_APIS='[{"name":"mock","url":"http://localhost:${PORT}/v1","key":"${KEY}"}]'\n`);
});
