"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { del, getJSON, patchJSON } from "../../lib/api";

interface Asset {
  id: string; slug: string; name: string; description?: string | null;
  category: string; subcategory?: string | null; style?: string | null; type: string;
  version: string; placement: string; tileSize: number; widthTiles: number; heightTiles: number;
  tileId: number | null; tilesetKey: string | null; placeable: boolean;
  collision?: { blocking: boolean } | null; interaction?: { class: string } | null;
  tags: { slug: string; label: string }[];
  files: { url: string; role: string }[];
  pack: { id: string; name: string };
  license?: { name: string; licenseName?: string; licenseUrl?: string; attributionRequired: boolean; commercialUseAllowed: boolean; redistributionAllowed: boolean; notes?: string } | null;
}

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [a, setA] = useState<Asset | null>(null);
  const [tags, setTags] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const asset = await getJSON<Asset>(`/api/assets/${id}`);
    setA(asset);
    setTags(asset.tags.map((t) => t.label).join(", "));
  }
  useEffect(() => { load().catch((e) => setMsg(String(e))); /* eslint-disable-next-line */ }, [id]);

  if (!a) return <p className="text-muted">{msg ?? "Loading…"}</p>;
  const img = a.files.find((f) => f.role === "tile_image") ?? a.files.find((f) => f.role === "atlas") ?? a.files[0];

  async function saveField(patch: Record<string, unknown>) {
    setMsg(null);
    try {
      await patchJSON(`/api/assets/${a!.id}`, patch);
      await load();
      setMsg("Saved.");
    } catch (e) { setMsg(String(e)); }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/assets" className="hover:text-accent">Assets</Link> / <span className="text-ink">{a.name}</span>
      </div>

      <div className="grid md:grid-cols-[220px_1fr] gap-6">
        <div className="card p-4 flex flex-col items-center gap-3">
          <div className="h-32 flex items-center justify-center">
            {img && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img.url} alt={a.name} className="pixelated max-h-32" style={{ imageRendering: "pixelated" }} />
            )}
          </div>
          {a.placeable ? <span className="chip text-ok border-ok/40">placeable by MCP</span> : <span className="chip text-warn border-warn/40">missing tileId — unplaceable</span>}
          <div className="text-xs text-muted text-center">
            {a.tilesetKey ? <Link href={`/tilesets/${a.tilesetKey}`} className="hover:text-accent">{a.tilesetKey}</Link> : "no tileset"} · tile #{a.tileId ?? "?"}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h1 className="text-xl font-semibold text-ink">{a.name}</h1>
            <code className="text-xs text-muted">{a.slug}</code>
          </div>
          {msg && <div className="text-xs text-accent">{msg}</div>}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" value={a.category} onSave={(v) => saveField({ category: v })} />
            <Field label="Style" value={a.style ?? ""} onSave={(v) => saveField({ style: v })} />
            <Field label="Placement" value={a.placement} onSave={(v) => saveField({ placement: v })} select={["floor", "wall", "ceiling", "overlay"]} />
            <Field label="Type" value={a.type} onSave={(v) => saveField({ type: v })} />
            <Field label="Width (tiles)" value={String(a.widthTiles)} onSave={(v) => saveField({ widthTiles: Number(v) })} />
            <Field label="Height (tiles)" value={String(a.heightTiles)} onSave={(v) => saveField({ heightTiles: Number(v) })} />
            <Field label="Tile id" value={a.tileId == null ? "" : String(a.tileId)} onSave={(v) => saveField({ tileId: v === "" ? null : Number(v) })} />
            <Field label="Version" value={a.version} onSave={(v) => saveField({ version: v })} />
          </div>

          <div>
            <label className="label">Tags (comma-separated)</label>
            <div className="flex gap-2">
              <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
              <button className="btn" onClick={() => saveField({ tags: tags.split(",").map((s) => s.trim()).filter(Boolean) })}>Save</button>
            </div>
          </div>

          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2 text-ink">
              <input type="checkbox" checked={a.collision?.blocking ?? false} onChange={(e) => saveField({ collision: { blocking: e.target.checked } })} />
              blocks movement (collision)
            </label>
          </div>
          <Field label="Interaction class" value={a.interaction?.class ?? ""} onSave={(v) => saveField({ interaction: v ? { class: v } : null })} placeholder="workstation, seat, door…" />

          {a.license && (
            <div className="card p-3 bg-subtle text-sm space-y-1">
              <div className="font-medium text-ink">License: {a.license.licenseName ?? a.license.name}</div>
              {a.license.licenseUrl && <a href={a.license.licenseUrl} className="text-accent text-xs" target="_blank" rel="noreferrer">{a.license.licenseUrl}</a>}
              <div className="flex flex-wrap gap-1.5 text-xs">
                <span className="chip">{a.license.attributionRequired ? "attribution required" : "no attribution"}</span>
                <span className="chip">{a.license.commercialUseAllowed ? "commercial OK" : "no commercial"}</span>
                <span className="chip">{a.license.redistributionAllowed ? "redistributable" : "no redistribution"}</span>
              </div>
              {a.license.notes && <p className="text-xs text-muted">{a.license.notes}</p>}
            </div>
          )}

          <button
            className="btn btn-danger"
            onClick={async () => { if (confirm("Delete this asset?")) { await del(`/api/assets/${a.id}`); router.push("/assets"); } }}
          >
            Delete asset
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onSave, select, placeholder }: { label: string; value: string; onSave: (v: string) => void; select?: string[]; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-1">
        {select ? (
          <select className="input" value={v} onChange={(e) => { setV(e.target.value); onSave(e.target.value); }}>
            {select.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input className="input" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />
        )}
      </div>
    </div>
  );
}
