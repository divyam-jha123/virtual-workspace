import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const BASE_ENV = { MAP_MCP_WORKSPACE: "/tmp/does-not-matter" } as NodeJS.ProcessEnv;

describe("ASSET_APIS", () => {
  it("is empty by default", () => {
    expect(loadConfig(BASE_ENV).assetApis).toEqual([]);
  });

  it("parses a multi-source list", () => {
    const env = {
      ...BASE_ENV,
      ASSET_APIS: JSON.stringify([
        { name: "vendorA", url: "https://a.example.com/v1", key: "key-a" },
        { name: "vendorB", url: "https://b.example.com/v1" },
      ]),
    } as NodeJS.ProcessEnv;
    expect(loadConfig(env).assetApis).toEqual([
      { name: "vendorA", url: "https://a.example.com/v1", key: "key-a" },
      { name: "vendorB", url: "https://b.example.com/v1", key: undefined },
    ]);
  });

  it("takes precedence over the legacy ASSET_SOURCE/ASSET_API_URL pair", () => {
    const env = {
      ...BASE_ENV,
      ASSET_SOURCE: "api",
      ASSET_API_URL: "https://legacy.example.com",
      ASSET_APIS: JSON.stringify([{ name: "vendorA", url: "https://a.example.com" }]),
    } as NodeJS.ProcessEnv;
    expect(loadConfig(env).assetApis).toEqual([{ name: "vendorA", url: "https://a.example.com", key: undefined }]);
  });

  it("falls back to the legacy pair as a single source when ASSET_APIS is unset", () => {
    const env = { ...BASE_ENV, ASSET_SOURCE: "api", ASSET_API_URL: "https://legacy.example.com", ASSET_API_KEY: "legacy-key" } as NodeJS.ProcessEnv;
    expect(loadConfig(env).assetApis).toEqual([{ name: "api", url: "https://legacy.example.com", key: "legacy-key" }]);
  });

  it("rejects malformed JSON with a fix hint", () => {
    const env = { ...BASE_ENV, ASSET_APIS: "{not json" } as NodeJS.ProcessEnv;
    const err = (() => {
      try {
        loadConfig(env);
        return null;
      } catch (e) {
        return e as any;
      }
    })();
    expect(err?.code).toBe("INVALID_ARGUMENT");
    expect(err.diagnostics[0].fix).toMatch(/JSON array/);
  });

  it("rejects a non-array value", () => {
    const env = { ...BASE_ENV, ASSET_APIS: JSON.stringify({ name: "vendorA", url: "https://a.example.com" }) } as NodeJS.ProcessEnv;
    expect(() => loadConfig(env)).toThrow(/must be a JSON array/);
  });

  it("rejects an entry missing a name", () => {
    const env = { ...BASE_ENV, ASSET_APIS: JSON.stringify([{ url: "https://a.example.com" }]) } as NodeJS.ProcessEnv;
    expect(() => loadConfig(env)).toThrow(/missing "name"/);
  });

  it("rejects an entry missing a url", () => {
    const env = { ...BASE_ENV, ASSET_APIS: JSON.stringify([{ name: "vendorA" }]) } as NodeJS.ProcessEnv;
    expect(() => loadConfig(env)).toThrow(/missing "url"/);
  });

  it("rejects the reserved name \"local\"", () => {
    const env = { ...BASE_ENV, ASSET_APIS: JSON.stringify([{ name: "local", url: "https://a.example.com" }]) } as NodeJS.ProcessEnv;
    expect(() => loadConfig(env)).toThrow(/reserved name/);
  });

  it("rejects two entries with the same name", () => {
    const env = {
      ...BASE_ENV,
      ASSET_APIS: JSON.stringify([
        { name: "vendorA", url: "https://a.example.com" },
        { name: "vendorA", url: "https://a2.example.com" },
      ]),
    } as NodeJS.ProcessEnv;
    expect(() => loadConfig(env)).toThrow(/two sources named "vendorA"/);
  });
});
