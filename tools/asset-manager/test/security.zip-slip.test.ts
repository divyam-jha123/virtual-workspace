import { describe, expect, it } from "vitest";
import { extractZip } from "../src/import/zip.js";
import { makeZip } from "./helpers/make-zip.js";

const limits = { maxEntries: 100, maxTotalBytes: 10_000_000, maxEntryBytes: 5_000_000 };
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("extractZip safety", () => {
  it("extracts a benign archive", async () => {
    const zip = makeZip([
      { name: "a.png", data: png },
      { name: "nested/b.png", data: png },
      { name: "dir/", data: Buffer.alloc(0) },
    ]);
    const out = await extractZip(zip, limits);
    expect(out.map((e) => e.name).sort()).toEqual(["a.png", "nested/b.png"]);
  });

  it("rejects a ../ traversal entry (zip-slip)", async () => {
    const zip = makeZip([{ name: "../evil.png", data: png }]);
    await expect(extractZip(zip, limits)).rejects.toMatchObject({ code: "zip-slip" });
  });

  it("rejects a deep ../../ traversal entry", async () => {
    const zip = makeZip([{ name: "a/../../etc/passwd", data: png }]);
    await expect(extractZip(zip, limits)).rejects.toMatchObject({ code: "zip-slip" });
  });

  it("rejects an absolute-path entry", async () => {
    const zip = makeZip([{ name: "/etc/passwd", data: png }]);
    await expect(extractZip(zip, limits)).rejects.toMatchObject({ code: "zip-slip" });
  });

  it("rejects a symlink entry", async () => {
    const zip = makeZip([{ name: "link.png", data: Buffer.from("/etc/passwd"), unixMode: 0o120777 }]);
    await expect(extractZip(zip, limits)).rejects.toMatchObject({ code: "zip-symlink" });
  });

  it("enforces the entry-count cap", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.png`, data: png }));
    await expect(extractZip(makeZip(many), { ...limits, maxEntries: 3 })).rejects.toMatchObject({
      status: 413,
    });
  });

  it("enforces the total-size cap", async () => {
    const big = Buffer.alloc(1000, 1);
    await expect(
      extractZip(makeZip([{ name: "big.bin", data: big }]), { ...limits, maxTotalBytes: 100 }),
    ).rejects.toMatchObject({ status: 413 });
  });
});
