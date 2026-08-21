"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getJSON, postJSON } from "../../lib/api";

interface Tile { tileId: number; image?: string; imageUrl?: string; width: number; height: number; atlas?: { x: number; y: number } }
interface Tileset {
  key: string; name: string; kind: "grid" | "collection"; tileWidth: number; tileHeight: number;
  columns: number; tileCount: number; imageWidth?: number | null; imageHeight?: number | null;
  placeable: boolean; gridSize: number; atlasUrl: string | null; packId: string; packName: string; tiles: Tile[];
}

const PLACEMENTS = ["floor", "wall", "ceiling", "overlay"];
const ZOOMS = [2, 3, 4, 6, 8];

export default function InspectorPage() {
  const { key } = useParams<{ key: string }>();
  const [ts, setTs] = useState<Tileset | null>(null);
  const [zoom, setZoom] = useState(4);
  const [showGrid, setShowGrid] = useState(true);
  const [selection, setSelection] = useState<{ tileId: number; w: number; h: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { getJSON<Tileset>(`/api/tilesets/${key}`).then(setTs).catch((e) => setMsg(String(e))); }, [key]);

  if (!ts) return <p className="text-muted">{msg ?? "Loading…"}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href={`/packs/${ts.packId}`} className="hover:text-accent">{ts.packName}</Link> /
        <span className="text-ink">{ts.name}</span>
        <span className="chip ml-2">{ts.kind}</span>
        {ts.placeable ? <span className="chip text-ok border-ok/40">16px · placeable</span> : <span className="chip text-warn border-warn/40">non-16 · hidden from /v1</span>}
      </div>

      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted">Zoom</span>
        {ZOOMS.map((z) => (
          <button key={z} className={`btn ${zoom === z ? "btn-accent" : ""}`} onClick={() => setZoom(z)}>{z}×</button>
        ))}
        {ts.kind === "grid" && (
          <label className="flex items-center gap-1.5 text-ink ml-2">
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> 16px grid
          </label>
        )}
        <span className="ml-auto text-xs text-muted">
          {selection ? `selected tile #${selection.tileId} · ${selection.w}×${selection.h}` : "click a tile to select its tileId"}
        </span>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="card p-4 overflow-auto">
          {ts.kind === "grid" && ts.atlasUrl ? (
            <GridAtlas ts={ts} zoom={zoom} showGrid={showGrid} selection={selection} onSelect={setSelection} />
          ) : (
            <CollectionGrid ts={ts} zoom={zoom} selection={selection} onSelect={setSelection} />
          )}
        </div>

        <AssetForm
          tilesetKey={ts.key}
          selection={selection}
          onCreated={(name) => setMsg(`Created asset "${name}".`)}
        />
      </div>
      {msg && <div className="card p-3 text-sm text-accent">{msg}</div>}
    </div>
  );
}

/** Single-atlas tileset: render the image scaled with a clickable 16px grid overlay. */
function GridAtlas({ ts, zoom, showGrid, selection, onSelect }: {
  ts: Tileset; zoom: number; showGrid: boolean; selection: { tileId: number } | null; onSelect: (s: { tileId: number; w: number; h: number }) => void;
}) {
  const cols = ts.columns || 1;
  const rows = Math.ceil(ts.tileCount / cols);
  const g = ts.gridSize;
  const w = (ts.imageWidth ?? cols * g) * zoom;
  const h = (ts.imageHeight ?? rows * g) * zoom;

  return (
    <div className="relative inline-block" style={{ width: w, height: h }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ts.atlasUrl!} alt={ts.name} className="pixelated block" style={{ width: w, height: h, imageRendering: "pixelated" }} />
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${cols}, ${g * zoom}px)`, gridTemplateRows: `repeat(${rows}, ${g * zoom}px)` }}>
        {Array.from({ length: cols * rows }).map((_, i) => {
          const disabled = i >= ts.tileCount;
          const sel = selection?.tileId === i;
          return (
            <button
              key={i}
              disabled={disabled}
              onClick={() => onSelect({ tileId: i, w: 1, h: 1 })}
              title={disabled ? "" : `tile #${i}`}
              className={`${showGrid ? "border border-white/10" : ""} ${sel ? "ring-2 ring-accent bg-accent/20" : "hover:bg-white/10"} ${disabled ? "pointer-events-none" : ""}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Collection tileset: a gallery of per-tile images, each clickable. */
function CollectionGrid({ ts, zoom, selection, onSelect }: {
  ts: Tileset; zoom: number; selection: { tileId: number } | null; onSelect: (s: { tileId: number; w: number; h: number }) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {ts.tiles.map((t) => {
        const sel = selection?.tileId === t.tileId;
        const tw = Math.max(1, Math.round(t.width / ts.gridSize));
        const th = Math.max(1, Math.round(t.height / ts.gridSize));
        return (
          <button
            key={t.tileId}
            onClick={() => onSelect({ tileId: t.tileId, w: tw, h: th })}
            className={`card p-2 flex flex-col items-center gap-1 ${sel ? "ring-2 ring-accent" : "hover:border-accent/40"}`}
            title={`tile #${t.tileId} · ${t.width}×${t.height}px`}
          >
            <div className="flex items-center justify-center" style={{ height: 48 }}>
              {t.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.imageUrl} alt={t.image} className="pixelated" style={{ imageRendering: "pixelated", width: t.width * (zoom / 2), height: t.height * (zoom / 2) }} />
              ) : (
                <span className="text-muted text-xs">—</span>
              )}
            </div>
            <span className="text-[10px] text-muted">#{t.tileId}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Turn the selected tile (with derived footprint) into an Asset record. */
function AssetForm({ tilesetKey, selection, onCreated }: {
  tilesetKey: string; selection: { tileId: number; w: number; h: number } | null; onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("furniture");
  const [placement, setPlacement] = useState("floor");
  const [w, setW] = useState(1);
  const [h, setH] = useState(1);
  const [blocking, setBlocking] = useState(true);
  const [interactionClass, setInteractionClass] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lastTile = useRef<number | null>(null);

  useEffect(() => {
    if (selection && selection.tileId !== lastTile.current) {
      lastTile.current = selection.tileId;
      setW(selection.w);
      setH(selection.h);
    }
  }, [selection]);

  async function create() {
    if (!selection) return;
    setBusy(true);
    setErr(null);
    try {
      await postJSON(`/api/tilesets/${tilesetKey}/assets`, {
        name,
        tileId: selection.tileId,
        category,
        placement,
        widthTiles: Number(w),
        heightTiles: Number(h),
        collision: { blocking },
        ...(interactionClass ? { interaction: { class: interactionClass } } : {}),
        tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
      });
      onCreated(name);
      setName("");
      setTags("");
      setInteractionClass("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-3 sticky top-20">
      <h3 className="font-medium text-ink">Make an asset</h3>
      <p className="text-xs text-muted">
        {selection ? <>Tile <span className="text-accent">#{selection.tileId}</span> selected.</> : "Select a tile in the atlas first."}
      </p>
      <div>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Office desk" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Category</label><input className="input" value={category} onChange={(e) => setCategory(e.target.value)} /></div>
        <div>
          <label className="label">Placement</label>
          <select className="input" value={placement} onChange={(e) => setPlacement(e.target.value)}>
            {PLACEMENTS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div><label className="label">Width (tiles)</label><input type="number" min={1} className="input" value={w} onChange={(e) => setW(Number(e.target.value))} /></div>
        <div><label className="label">Height (tiles)</label><input type="number" min={1} className="input" value={h} onChange={(e) => setH(Number(e.target.value))} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} /> blocks movement
      </label>
      <div>
        <label className="label">Interaction class (optional)</label>
        <input className="input" value={interactionClass} onChange={(e) => setInteractionClass(e.target.value)} placeholder="workstation, seat, door…" />
      </div>
      <div>
        <label className="label">Tags</label>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="desk, table, office" />
      </div>
      {err && <div className="text-xs text-danger">{err}</div>}
      <button className="btn btn-accent w-full justify-center" disabled={!selection || !name.trim() || busy} onClick={create}>
        + Create asset from tile #{selection?.tileId ?? "?"}
      </button>
    </div>
  );
}
