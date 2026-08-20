import { CATALOG, TILESETS } from "./fixtures.js";

export interface FakeApiOptions {
  host?: string;
  /** Queue of canned failures consumed before the normal handler runs. */
  failures?: Array<{ status: number; headers?: Record<string, string> } | "network">;
  etag?: string;
}

export interface FakeApi {
  fetchImpl: typeof fetch;
  calls: string[];
  /** Requests that actually left, including retried attempts. */
  attempts: number;
  setIfNoneMatchSeen: (value: string | null) => void;
  lastIfNoneMatch: string | null;
  headers: Array<Record<string, string>>;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers as Record<string, string>) },
    ...init,
  });
}

/** A tiny in-memory stand-in for the asset API, matching the assumed contract. */
export function createFakeAssetApi(options: FakeApiOptions = {}): FakeApi {
  const host = options.host ?? "https://assets.example.com";
  const failures = [...(options.failures ?? [])];
  const state: FakeApi = {
    calls: [],
    attempts: 0,
    headers: [],
    lastIfNoneMatch: null,
    setIfNoneMatchSeen(value) {
      state.lastIfNoneMatch = value;
    },
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      state.attempts += 1;
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      state.headers.push(headers);
      state.setIfNoneMatchSeen(headers["if-none-match"] ?? null);

      const failure = failures.shift();
      if (failure === "network") throw new Error("ECONNRESET");
      // 304/204 are null-body statuses; the Response constructor rejects "".
      if (failure) return new Response(failure.status === 304 || failure.status === 204 ? null : "", { status: failure.status, headers: failure.headers });

      state.calls.push(`${url.pathname}${url.search}`);

      if (url.origin !== host) return new Response("", { status: 404 });

      if (url.pathname === "/v1/tilesets") return json({ items: TILESETS });

      if (url.pathname.startsWith("/v1/assets/")) {
        const id = decodeURIComponent(url.pathname.slice("/v1/assets/".length));
        const asset = CATALOG.find((a) => a.id === id);
        return asset ? json({ asset }) : new Response("", { status: 404 });
      }

      if (url.pathname === "/v1/assets") {
        const q = url.searchParams.get("q")?.toLowerCase() ?? "";
        const category = url.searchParams.get("category");
        const style = url.searchParams.get("style");
        const tileSize = url.searchParams.get("tileSize");
        const items = CATALOG.filter((a) => {
          if (category && a.category !== category) return false;
          if (style && a.style !== style) return false;
          if (tileSize && a.tileSize !== Number(tileSize)) return false;
          if (!q) return true;
          // `q` is whitespace-separated terms, matched as OR — the assumed contract.
          const text = `${a.id} ${a.name} ${a.tags.join(" ")}`.toLowerCase();
          return q.split(/\s+/).filter(Boolean).some((term) => text.includes(term));
        });
        const responseEtag = options.etag;
        if (responseEtag && headers["if-none-match"] === responseEtag) {
          return new Response(null, { status: 304, headers: { etag: responseEtag } });
        }
        return json({ items }, { headers: responseEtag ? { etag: responseEtag } : {} });
      }

      if (url.pathname.startsWith("/v1/tilesets/")) {
        return json({ name: "office-core", tilewidth: 32, tileheight: 32, image: "office-core.png" });
      }

      return new Response("", { status: 404 });
    }) as unknown as typeof fetch,
  };
  return state;
}

export const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
