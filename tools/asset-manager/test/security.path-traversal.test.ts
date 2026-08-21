import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStorage } from "../src/storage/local-storage.js";
import { sanitizeFilename, sanitizePngName } from "../src/lib/filenames.js";
import { normalizeTsjForVendor } from "../src/tileset/tsj.js";

describe("filename sanitization", () => {
  it("reduces any reference to a safe basename", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("a/b/c/monitor.png")).toBe("monitor.png");
    expect(sanitizeFilename("weird name!@#.png")).toBe("weird_name___.png");
    expect(sanitizeFilename("..\\..\\windows\\system32\\evil.png")).toBe("evil.png");
  });

  it("rejects names that reduce to nothing dangerous", () => {
    expect(() => sanitizeFilename("../")).toThrow();
    expect(() => sanitizeFilename("..")).toThrow();
  });

  it("requires a .png extension where demanded", () => {
    expect(() => sanitizePngName("../../evil.sh")).toThrow();
    expect(sanitizePngName("dir/atlas.png")).toBe("atlas.png");
  });
});

describe("LocalStorage key jail", () => {
  const store = new LocalStorage(path.join(os.tmpdir(), "am-store-test"));

  it("refuses a traversal key on read", async () => {
    await expect(store.getObject("../../../etc/passwd")).rejects.toBeTruthy();
  });

  it("refuses a NUL-bearing key", async () => {
    await expect(store.getObject("ab\0cd")).rejects.toBeTruthy();
  });

  it("round-trips a normal sharded key", async () => {
    const key = LocalStorage.newKey("png");
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await store.putObject(key, bytes, "image/png");
    const back = await store.getObject(key);
    expect([...back]).toEqual([1, 2, 3, 4]);
  });
});

describe("tsj image references are basenames only", () => {
  it("strips directory components from a malicious .tsj image path", () => {
    const out = normalizeTsjForVendor({
      image: "../../../../etc/passwd.png",
      tilewidth: 32,
      tileheight: 32,
    });
    expect(out.image).toBe("passwd.png");
    expect(out.tilewidth).toBe(16); // forced to the map grid
  });

  it("strips directory components from per-tile images", () => {
    const out = normalizeTsjForVendor({
      tiles: [{ id: 0, image: "a/b/../c/desk.png" }],
      tilewidth: 46,
    });
    expect((out.tiles as Array<{ image: string }>)[0]!.image).toBe("desk.png");
  });
});
