import path from "node:path";
import { MapMcpError, redact } from "../../errors.js";
import { assetPath, authHeaders, searchPath, tilesetPath, tilesetsPath, toAssetRecord, toAssetRecords, toSelectionSession, toTilesetRefs } from "./asset-api-dto.js";
import { rank } from "./search.js";
import type { AssetQuery, AssetRecord, AssetRepository, CreateSelectionInput, ImageBlob, SelectionSession, TilesetJson, TilesetRef } from "./types.js";

export interface HttpAssetRepositoryOptions {
  baseUrl: string;
  apiKey: string | undefined;
  defaults: { tileSize: number };
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  /** Injected in tests so backoff does not actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Hard cap on any single response body. */
  maxBytes?: number;
  offline?: boolean;
}

interface CacheEntry {
  etag?: string;
  payload: unknown;
}

const IMAGE_CONTENT_TYPES = new Set(["image/png", "image/x-png"]);
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function unavailable(message: string, fix: string): MapMcpError {
  return new MapMcpError("ASSET_API_UNAVAILABLE", redact(message), { rule: "asset-api-unreachable", fix });
}

/**
 * The only code that knows the asset API's transport. Everything it does is
 * outbound, host-pinned, and size-capped:
 *
 *  - every request URL is built from ASSET_API_URL; a URL that resolves to a
 *    different host is refused, including one that arrived inside a payload
 *  - redirects are handled manually and blocked if they leave the host
 *  - the API key is sent as a header, never logged, never echoed in a diagnostic
 */
export class HttpAssetRepository implements AssetRepository {
  readonly kind = "api" as const;

  private readonly base: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly offline: boolean;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly options: HttpAssetRepositoryOptions) {
    let base: URL;
    try {
      base = new URL(options.baseUrl);
    } catch {
      throw new MapMcpError("INVALID_ARGUMENT", `ASSET_API_URL is not a valid URL: ${options.baseUrl}`, {
        rule: "asset-api-config",
        fix: "Set ASSET_API_URL to an absolute https URL, e.g. https://assets.example.com/v1.",
      });
    }
    if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") {
      throw new MapMcpError("INVALID_ARGUMENT", `ASSET_API_URL must use https (got ${base.protocol}//)`, {
        rule: "asset-api-config",
        fix: "Use an https URL, or localhost for a local mock.",
      });
    }
    this.base = base;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
    this.offline = options.offline ?? false;
  }

  /** Builds an absolute URL and refuses anything that leaves the configured host. */
  private urlFor(relative: string): URL {
    const url = new URL(relative.replace(/^\//, ""), this.base.href.endsWith("/") ? this.base.href : `${this.base.href}/`);
    this.assertSameHost(url);
    return url;
  }

  private assertSameHost(url: URL): void {
    if (url.protocol !== this.base.protocol || url.host !== this.base.host) {
      throw new MapMcpError("INVALID_ARGUMENT", `Refusing to contact ${url.protocol}//${url.host}: only ${this.base.host} is allowed`, {
        rule: "egress-host-pin",
        fix: "The asset API host is pinned to ASSET_API_URL. URLs found inside map or asset payloads are never fetched.",
      });
    }
  }

  private async request(url: URL, accept: string, etag?: string, init?: { method?: string; body?: string }): Promise<Response> {
    if (this.offline) {
      throw unavailable("MAP_MCP_OFFLINE is set; no outbound request was attempted", "Unset MAP_MCP_OFFLINE, or use ASSET_SOURCE=local.");
    }

    const method = init?.method ?? "GET";
    // GET is idempotent, so a retry is free. A POST is not: retrying a create
    // that actually succeeded would leave a duplicate behind, so it gets one shot.
    const maxRetries = method === "GET" ? this.maxRetries : 0;

    let attempt = 0;
    let current = url;

    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(current, {
          method,
          redirect: "manual",
          signal: controller.signal,
          ...(init?.body === undefined ? {} : { body: init.body }),
          headers: {
            accept,
            ...authHeaders(this.options.apiKey),
            ...(etag ? { "if-none-match": etag } : {}),
            ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
          },
        });
      } catch (err) {
        clearTimeout(timer);
        if (attempt < maxRetries) {
          await this.sleep(backoffMs(attempt++));
          continue;
        }
        throw unavailable(`Asset API request failed: ${(err as Error).message}`, "Check network access from the container, or set ASSET_SOURCE=local to work offline.");
      }
      clearTimeout(timer);

      // 304 is "not modified", not a redirect — it is handled by the ETag path.
      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        const location = response.headers.get("location");
        if (!location) throw unavailable(`Asset API returned ${response.status} with no Location header`, "Report this to the asset API owner.");
        const next = new URL(location, current);
        // A redirect off-host is the classic SSRF vector; refuse it outright.
        this.assertSameHost(next);
        current = next;
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw unavailable(
          `Asset API returned ${response.status} (check ASSET_API_KEY)`,
          "Set a valid ASSET_API_KEY, or set ASSET_SOURCE=local to use content/assets/.",
        );
      }

      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt));
        attempt += 1;
        continue;
      }

      return response;
    }
  }

  /** GET returning JSON, with ETag revalidation against the in-memory cache. */
  private async getJson(relative: string): Promise<unknown> {
    const url = this.urlFor(relative);
    const cached = this.cache.get(url.href);
    const response = await this.request(url, "application/json", cached?.etag);

    if (response.status === 304 && cached) return cached.payload;
    if (response.status === 404) return null;
    if (!response.ok) {
      throw unavailable(`Asset API returned ${response.status} for ${relative}`, "Retry, or set ASSET_SOURCE=local to work from content/assets/.");
    }

    const text = await this.readCapped(response);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw unavailable(`Asset API returned non-JSON for ${relative}`, "Report this to the asset API owner; the endpoint should return application/json.");
    }

    const responseEtag = response.headers.get("etag");
    this.cache.set(url.href, { payload, ...(responseEtag ? { etag: responseEtag } : {}) });
    return payload;
  }

  private async readCapped(response: Response): Promise<string> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.maxBytes) {
      throw new MapMcpError("LIMIT_EXCEEDED", `Asset API response is ${declared} bytes, over the ${this.maxBytes} byte cap`, {
        rule: "response-too-large",
        fix: "Narrow the query with a category or limit.",
      });
    }
    const text = await response.text();
    if (text.length > this.maxBytes) {
      throw new MapMcpError("LIMIT_EXCEEDED", `Asset API response exceeded the ${this.maxBytes} byte cap`, {
        rule: "response-too-large",
        fix: "Narrow the query with a category or limit.",
      });
    }
    return text;
  }

  async get(id: string): Promise<AssetRecord | null> {
    const payload = await this.getJson(assetPath(id));
    return payload === null ? null : toAssetRecord(payload, this.options.defaults);
  }

  async search(query: AssetQuery): Promise<AssetRecord[]> {
    const payload = await this.getJson(searchPath(query));
    const records = payload === null ? [] : toAssetRecords(payload, this.options.defaults);
    // The API does its own filtering; re-rank locally so ordering is identical
    // whichever source answered.
    return rank(records, query).slice(0, query.limit ?? 25);
  }

  async listTilesets(): Promise<TilesetRef[]> {
    const payload = await this.getJson(tilesetsPath());
    return payload === null ? [] : toTilesetRefs(payload);
  }

  async fetchTileset(id: string, version?: string): Promise<{ tsj: TilesetJson; images: ImageBlob[] }> {
    const payload = await this.getJson(tilesetPath(id, version));
    if (payload === null || typeof payload !== "object") {
      throw new MapMcpError("ASSET_NOT_FOUND", `Asset API has no tileset "${id}"`, {
        rule: "tileset-missing",
        fix: "Call list_tilesets to see the available tileset ids.",
      });
    }
    const tsj = payload as TilesetJson;
    const images: ImageBlob[] = [];
    for (const reference of imageReferences(tsj)) {
      images.push(await this.fetchImage(id, reference));
    }
    return { tsj, images };
  }

  /**
   * Image paths come from the .tsj, which is remote data. They are treated as
   * names, not URLs: resolved against the pinned host, stripped of any directory
   * component, size-capped, and magic-byte checked before anyone writes them.
   */
  private async fetchImage(tilesetId: string, reference: string): Promise<ImageBlob> {
    const filename = sanitizeFilename(reference);
    const url = this.urlFor(`/tilesets/${encodeURIComponent(tilesetId)}/${encodeURIComponent(filename)}`);
    const response = await this.request(url, "image/png");
    if (!response.ok) {
      throw unavailable(`Asset API returned ${response.status} for atlas image ${filename}`, "Retry sync_tilesets, or report a broken tileset to the asset API owner.");
    }

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!IMAGE_CONTENT_TYPES.has(contentType)) {
      throw new MapMcpError("INVALID_ARGUMENT", `Atlas image ${filename} has content-type "${contentType}", expected image/png`, {
        rule: "atlas-content-type",
        fix: "Only PNG atlases are accepted. Report the mismatch to the asset API owner.",
      });
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.maxBytes) {
      throw new MapMcpError("LIMIT_EXCEEDED", `Atlas image ${filename} is ${bytes.byteLength} bytes, over the ${this.maxBytes} byte cap`, {
        rule: "atlas-too-large",
        fix: "Split the atlas, or raise the cap deliberately.",
      });
    }
    if (!PNG_MAGIC.every((byte, index) => bytes[index] === byte)) {
      throw new MapMcpError("INVALID_ARGUMENT", `Atlas image ${filename} is not a PNG`, {
        rule: "atlas-decode",
        fix: "The bytes did not start with the PNG signature. Report the corrupt asset to the API owner.",
      });
    }

    return { filename, contentType: "image/png", bytes };
  }

  // --- selection handshake --------------------------------------------------

  async createSelection(input: CreateSelectionInput): Promise<SelectionSession> {
    return this.selectionCall("/selections", {
      method: "POST",
      body: JSON.stringify({
        prompt: input.prompt,
        candidateIds: input.candidateIds,
        ...(input.ttlSeconds === undefined ? {} : { ttlSeconds: input.ttlSeconds }),
      }),
    });
  }

  async readSelection(token: string): Promise<SelectionSession> {
    // Never ETag-cached: a poll must see the answer the instant it lands.
    return this.selectionCall(`/selections/${encodeURIComponent(token)}`);
  }

  async cancelSelection(token: string): Promise<SelectionSession> {
    return this.selectionCall(`/selections/${encodeURIComponent(token)}/cancel`, { method: "POST" });
  }

  private async selectionCall(relative: string, init?: { method?: string; body?: string }): Promise<SelectionSession> {
    const response = await this.request(this.urlFor(relative), "application/json", undefined, init);
    if (response.status === 404) {
      throw new MapMcpError("NOT_FOUND", "That selection no longer exists — it may have expired.", {
        rule: "selection-missing",
        fix: "Ask again to get a fresh link.",
      });
    }
    if (!response.ok) {
      throw unavailable(`Asset API returned ${response.status} for ${relative}`, "Retry, or choose an asset directly by id.");
    }
    const text = await this.readCapped(response);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw unavailable(`Asset API returned non-JSON for ${relative}`, "Report this to the asset API owner.");
    }
    return toSelectionSession(payload);
  }

  async health(): Promise<{ reachable: boolean; detail?: string }> {
    try {
      await this.getJson(tilesetsPath());
      return { reachable: true, detail: `asset API at ${this.base.host} reachable` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { reachable: false, detail: redact(message) };
    }
  }
}

function backoffMs(attempt: number): number {
  // 200ms, 400ms, 800ms ... with a little jitter so parallel calls do not sync up.
  return 200 * 2 ** attempt + Math.floor(Math.random() * 100);
}

/** Remote-supplied names never contribute a path: basename only, safe charset. */
export function sanitizeFilename(reference: string): string {
  const base = path.basename(reference.split("\\").join("/"));
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  if (cleaned === "" || !cleaned.toLowerCase().endsWith(".png")) {
    throw new MapMcpError("INVALID_ARGUMENT", `Refusing atlas filename "${reference}"`, {
      rule: "atlas-filename",
      fix: "Atlas images must be plain .png filenames with no directory component.",
    });
  }
  return cleaned;
}

/** Collects `image` fields from a tileset, both the atlas form and per-tile images. */
export function imageReferences(tsj: TilesetJson): string[] {
  const found = new Set<string>();
  if (typeof tsj.image === "string") found.add(tsj.image);
  const tiles = tsj.tiles;
  if (Array.isArray(tiles)) {
    for (const tile of tiles) {
      if (tile && typeof tile === "object" && typeof (tile as { image?: unknown }).image === "string") {
        found.add((tile as { image: string }).image);
      }
    }
  }
  return [...found];
}
