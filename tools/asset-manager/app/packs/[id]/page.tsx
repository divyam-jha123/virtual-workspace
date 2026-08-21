"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getJSON, postJSON } from "../../lib/api";

interface Tileset { id: string; key: string; name: string; kind: string; tileWidth: number; tileHeight: number; tileCount: number; placeable: boolean }
interface Pack { id: string; name: string; description?: string | null; nonPlaceableWarning: boolean; tileSize?: number | null; tilesets: Tileset[]; license?: { name: string } | null }

export default function PackDetail() {
  const { id } = useParams<{ id: string }>();
  const [pack, setPack] = useState<Pack | null>(null);
  const [tilesets, setTilesets] = useState<Tileset[]>([]);
  const [assetCount, setAssetCount] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const p = await getJSON<Pack>(`/api/packs/${id}`);
    setPack(p);
    setTilesets((await getJSON<{ items: Tileset[] }>(`/api/tilesets?packId=${id}`)).items);
    setAssetCount((await getJSON<{ items: unknown[] }>(`/api/assets?packId=${id}`)).items.length);
  }
  useEffect(() => { load().catch((e) => setMsg(String(e))); /* eslint-disable-next-line */ }, [id]);

  if (!pack) return <p className="text-muted">{msg ?? "Loading…"}</p>;

  async function vendor() {
    setMsg(null);
    try {
      const r = await postJSON<{ tilesets: string[]; assets: string[]; warnings: string[] }>("/api/vendor", { packId: id });
      setMsg(`Vendored ${r.tilesets.length} tileset(s), ${r.assets.length} asset(s). ${r.warnings.join(" ")}`);
    } catch (e) { setMsg(String(e)); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/" className="hover:text-accent">Packs</Link> / <span className="text-ink">{pack.name}</span>
        <button className="btn btn-accent ml-auto" onClick={vendor}>⤓ Vendor this pack</button>
        <Link href={`/assets?`} className="btn">{assetCount} assets</Link>
      </div>
      {pack.description && <p className="text-sm text-muted max-w-2xl">{pack.description}</p>}
      {pack.nonPlaceableWarning && (
        <div className="note note-warn">
          This pack targets {pack.tileSize}px tiles and is excluded from /v1 — the MCP will never see it.
        </div>
      )}
      {msg && <div className="card p-3 text-sm">{msg}</div>}

      <h2 className="text-sm uppercase tracking-wide text-muted">Tilesets</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tilesets.map((t) => (
          <Link key={t.id} href={`/tilesets/${t.key}`} className="card p-4 hover:border-accent/50">
            <div className="font-medium text-ink">{t.name}</div>
            <div className="text-xs text-muted mt-1">{t.kind} · {t.tileWidth}×{t.tileHeight}px · {t.tileCount} tiles</div>
            <div className="mt-2">
              {t.placeable ? <span className="chip text-ok border-ok/40">placeable (16px)</span> : <span className="chip text-warn border-warn/40">hidden from /v1</span>}
            </div>
            <div className="text-xs text-accent mt-2">Open inspector →</div>
          </Link>
        ))}
        {tilesets.length === 0 && <p className="text-muted text-sm">No tilesets in this pack yet.</p>}
      </div>
    </div>
  );
}
