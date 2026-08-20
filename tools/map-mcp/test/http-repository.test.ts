import { describe, expect, it, vi } from "vitest";
import { registerSecret } from "../src/errors.js";
import { HttpAssetRepository, imageReferences, sanitizeFilename } from "../src/services/assets/http-repository.js";
import { createFakeAssetApi, pngBytes } from "./helpers/fake-asset-api.js";

const BASE = "https://assets.example.com/v1";

function repo(overrides: Partial<ConstructorParameters<typeof HttpAssetRepository>[0]> = {}) {
  return new HttpAssetRepository({
    baseUrl: BASE,
    apiKey: "super-secret-key",
    defaults: { tileSize: 32 },
    fetchImpl: createFakeAssetApi().fetchImpl,
    sleep: async () => {},
    ...overrides,
  });
}

describe("auth + config", () => {
  it("sends the key as a header on every request", async () => {
    const api = createFakeAssetApi();
    await repo({ fetchImpl: api.fetchImpl }).search({ query: "desk" });
    expect(api.headers[0]?.authorization).toBe("Bearer super-secret-key");
    expect(api.headers[0]?.["x-api-key"]).toBe("super-secret-key");
  });

  it("rejects a non-https base url", () => {
    expect(() => repo({ baseUrl: "http://assets.example.com" })).toThrow(/https/);
  });

  it("rejects a malformed base url", () => {
    expect(() => repo({ baseUrl: "not-a-url" })).toThrow(/not a valid URL/);
  });
});

describe("failure handling", () => {
  it("surfaces 401 as one clear ASSET_API_UNAVAILABLE with a fix", async () => {
    const api = createFakeAssetApi({ failures: [{ status: 401 }] });
    const err = await repo({ fetchImpl: api.fetchImpl }).search({}).catch((e) => e);
    expect(err).toMatchObject({ code: "ASSET_API_UNAVAILABLE" });
    expect(err.diagnostics[0].message).toMatch(/401/);
    expect(err.diagnostics[0].fix).toMatch(/ASSET_SOURCE=local/);
  });

  it("does not retry a 401", async () => {
    const api = createFakeAssetApi({ failures: [{ status: 401 }] });
    await repo({ fetchImpl: api.fetchImpl }).search({}).catch(() => null);
    expect(api.attempts).toBe(1);
  });

  it("retries 5xx with backoff and then succeeds", async () => {
    const api = createFakeAssetApi({ failures: [{ status: 503 }, { status: 500 }] });
    const sleep = vi.fn(async () => {});
    const results = await repo({ fetchImpl: api.fetchImpl, sleep }).search({ query: "desk" });
    expect(api.attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(results.length).toBeGreaterThan(0);
  });

  it("honours Retry-After on 429", async () => {
    const api = createFakeAssetApi({ failures: [{ status: 429, headers: { "retry-after": "2" } }] });
    const sleep = vi.fn(async () => {});
    await repo({ fetchImpl: api.fetchImpl, sleep }).search({});
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("retries a transport error and gives up with a usable message", async () => {
    const api = createFakeAssetApi({ failures: ["network", "network", "network", "network"] });
    const err = await repo({ fetchImpl: api.fetchImpl }).search({}).catch((e) => e);
    expect(err).toMatchObject({ code: "ASSET_API_UNAVAILABLE" });
    expect(api.attempts).toBe(4);
  });

  it("reports unreachable through health() instead of throwing", async () => {
    const api = createFakeAssetApi({ failures: [{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }] });
    await expect(repo({ fetchImpl: api.fetchImpl }).health()).resolves.toMatchObject({ reachable: false });
  });

  it("attempts nothing at all when offline", async () => {
    const api = createFakeAssetApi();
    const err = await repo({ fetchImpl: api.fetchImpl, offline: true }).search({}).catch((e) => e);
    expect(api.attempts).toBe(0);
    expect(err).toMatchObject({ code: "ASSET_API_UNAVAILABLE" });
  });
});

describe("key redaction", () => {
  it("never echoes the key in a diagnostic", async () => {
    registerSecret("super-secret-key");
    const fetchImpl = (async () => {
      throw new Error("connect failed for Bearer super-secret-key (x-api-key: super-secret-key)");
    }) as unknown as typeof fetch;
    const err = await repo({ fetchImpl }).search({}).catch((e) => e);
    const serialized = JSON.stringify(err.toEnvelope());
    expect(serialized).not.toContain("super-secret-key");
    expect(serialized).toContain("redacted");
  });
});

describe("caching", () => {
  it("revalidates with If-None-Match and reuses the cached payload on 304", async () => {
    const api = createFakeAssetApi({ etag: 'W/"v1"' });
    const client = repo({ fetchImpl: api.fetchImpl });
    const first = await client.search({ query: "desk" });
    expect(api.lastIfNoneMatch).toBeNull();
    const second = await client.search({ query: "desk" });
    expect(api.lastIfNoneMatch).toBe('W/"v1"');
    expect(second).toEqual(first);
  });
});

describe("egress pinning", () => {
  it("blocks a redirect to another host", async () => {
    const api = createFakeAssetApi({ failures: [{ status: 302, headers: { location: "https://evil.example.net/assets" } }] });
    const err = await repo({ fetchImpl: api.fetchImpl }).search({}).catch((e) => e);
    expect(err.diagnostics[0].rule).toBe("egress-host-pin");
    expect(err.diagnostics[0].message).toMatch(/evil.example.net/);
  });

  it("follows a same-host redirect", async () => {
    const api = createFakeAssetApi({ failures: [{ status: 302, headers: { location: "/v1/assets?q=desk" } }] });
    const results = await repo({ fetchImpl: api.fetchImpl }).search({ query: "desk" });
    expect(results.map((r) => r.id)).toContain("office.desk.pod4");
  });

  it("never fetches a url that came from a payload", async () => {
    // `source.url` is attribution metadata; it must not become a request.
    const api = createFakeAssetApi();
    const client = repo({ fetchImpl: api.fetchImpl });
    await client.get("office.desk.pod4");
    expect(api.calls.every((call) => call.startsWith("/v1/"))).toBe(true);
  });
});

describe("downloads", () => {
  function tilesetApi(imageResponse: Response) {
    return (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith(".tsj")) {
        return new Response(JSON.stringify({ name: "office-core", tilewidth: 32, image: "office-core.png" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return imageResponse.clone();
    }) as unknown as typeof fetch;
  }

  it("accepts a well-formed png atlas", async () => {
    const response = new Response(pngBytes, { headers: { "content-type": "image/png" } });
    const result = await repo({ fetchImpl: tilesetApi(response) }).fetchTileset("office-core");
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.filename).toBe("office-core.png");
  });

  it("rejects a wrong content-type", async () => {
    const response = new Response(pngBytes, { headers: { "content-type": "text/html" } });
    const err = await repo({ fetchImpl: tilesetApi(response) }).fetchTileset("office-core").catch((e) => e);
    expect(err.diagnostics[0].rule).toBe("atlas-content-type");
  });

  it("rejects bytes that are not actually a png", async () => {
    const response = new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "image/png" } });
    const err = await repo({ fetchImpl: tilesetApi(response) }).fetchTileset("office-core").catch((e) => e);
    expect(err.diagnostics[0].rule).toBe("atlas-decode");
  });

  it("rejects an oversized atlas", async () => {
    const response = new Response(new Uint8Array([...pngBytes, ...new Uint8Array(64)]), { headers: { "content-type": "image/png" } });
    const err = await repo({ fetchImpl: tilesetApi(response), maxBytes: 16 }).fetchTileset("office-core").catch((e) => e);
    expect(err).toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("rejects an oversized json payload by declared content-length", async () => {
    const fetchImpl = (async () =>
      new Response("{}", { headers: { "content-type": "application/json", "content-length": "999999" } })) as unknown as typeof fetch;
    const err = await repo({ fetchImpl, maxBytes: 1024 }).search({}).catch((e) => e);
    expect(err).toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
});

describe("remote filenames", () => {
  it("strips any directory component a payload tries to smuggle in", () => {
    expect(sanitizeFilename("../../etc/passwd.png")).toBe("passwd.png");
    expect(sanitizeFilename("dir/atlas.png")).toBe("atlas.png");
    expect(sanitizeFilename("weird name!.png")).toBe("weird_name_.png");
  });

  it("refuses anything that is not a png filename", () => {
    expect(() => sanitizeFilename("../../evil.sh")).toThrow(/Refusing atlas filename/);
    expect(() => sanitizeFilename("")).toThrow();
  });

  it("collects atlas and per-tile image references", () => {
    expect(imageReferences({ image: "a.png", tiles: [{ image: "b.png" }, { id: 1 }] })).toEqual(["a.png", "b.png"]);
  });
});
