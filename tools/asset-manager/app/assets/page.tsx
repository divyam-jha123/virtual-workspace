"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface AssetFile { url: string; role: string; width?: number | null; height?: number | null }
interface Asset {
  id: string;
  slug: string;
  name: string;
  category: string;
  type: string;
  placement: string;
  tileSize: number;
  widthTiles: number;
  heightTiles: number;
  tileId: number | null;
  tilesetKey: string | null;
  placeable: boolean;
  tags: { slug: string; label: string }[];
  files: AssetFile[];
  imageUrl: string | null;
  pack: { name: string };
}

/**
 * The server resolves this: files hang off the TILESET, not the asset, so
 * `a.files` is empty for every asset and reading it here showed nothing.
 */
function thumb(a: Asset): string | null {
  return a.imageUrl ?? null;
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [placeableOnly, setPlaceableOnly] = useState(false);

  async function load() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (type) params.set("type", type);
    if (placeableOnly) params.set("placeable", "true");
    const res = await fetch(`/api/assets?${params}`, { cache: "no-store" });
    setAssets((await res.json()).items);
  }
  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type, placeableOnly]);

  const types = useMemo(() => [...new Set(assets.map((a) => a.type))].sort(), [assets]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-ink">Assets</h1>
        <input className="input max-w-xs" placeholder="Search name / tag / category…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input max-w-[10rem]" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <label className="text-sm flex items-center gap-1.5 text-ink">
          <input type="checkbox" checked={placeableOnly} onChange={(e) => setPlaceableOnly(e.target.checked)} /> placeable only
        </label>
        <div className="ml-auto flex gap-1">
          <button className={`btn ${view === "grid" ? "btn-accent" : ""}`} onClick={() => setView("grid")}>Grid</button>
          <button className={`btn ${view === "list" ? "btn-accent" : ""}`} onClick={() => setView("list")}>List</button>
        </div>
      </div>

      <p className="text-xs text-muted">{assets.length} asset(s)</p>

      {view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {assets.map((a) => (
            <Link key={a.id} href={`/assets/${a.slug}`} className="card p-3 flex flex-col items-center gap-2 hover:border-accent/50">
              <div className="h-16 flex items-center justify-center">
                {thumb(a) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb(a)!} alt={a.name} className="pixelated max-h-16" style={{ imageRendering: "pixelated" }} />
                ) : (
                  <span className="text-muted text-xs">no image</span>
                )}
              </div>
              <div className="text-center">
                <div className="text-xs text-ink truncate w-full">{a.name}</div>
                <div className="text-[10px] text-muted">{a.widthTiles}×{a.heightTiles} · {a.placement}</div>
              </div>
              {a.placeable ? (
                <span className="chip text-ok border-ok/40">placeable</span>
              ) : (
                <span className="chip text-warn border-warn/40">no tileId</span>
              )}
            </Link>
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-line">
          {assets.map((a) => (
            <Link key={a.id} href={`/assets/${a.slug}`} className="flex items-center gap-3 px-3 py-2 hover:bg-subtle">
              {thumb(a) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb(a)!} alt="" className="pixelated h-8 w-8 object-contain" style={{ imageRendering: "pixelated" }} />
              )}
              <span className="text-sm text-ink flex-1">{a.name}</span>
              <span className="chip">{a.type}</span>
              <span className="text-xs text-muted w-40 truncate">{a.tilesetKey ?? "—"} #{a.tileId ?? "?"}</span>
              {a.placeable ? <span className="chip text-ok border-ok/40">placeable</span> : <span className="chip text-warn border-warn/40">unplaceable</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
