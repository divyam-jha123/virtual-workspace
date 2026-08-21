"use client";

import { useState } from "react";
import Link from "next/link";

interface ReviewTileset { name: string; kind: string; tileWidth: number; tileHeight: number; tileCount: number; placeable: boolean; imagesTotal: number; imagesPresent: number; previewUrl: string | null }
interface Review { stagingId: string; pack: { name: string; tileSize?: number | null }; warnings: string[]; tilesets: ReviewTileset[]; looseImages: number; assets: number }

export default function ImportPage() {
  const [packName, setPackName] = useState("");
  const [tileSize, setTileSize] = useState("");
  const [licenseName, setLicenseName] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [committed, setCommitted] = useState<{ packSlug: string; tilesetKeys: string[]; assetSlugs: string[]; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function stage() {
    if (!files || !packName.trim()) return;
    setBusy(true); setErr(null); setCommitted(null);
    try {
      const fd = new FormData();
      fd.set("packName", packName);
      if (tileSize) fd.set("tileSize", tileSize);
      if (licenseName) fd.set("licenseName", licenseName);
      for (const f of Array.from(files)) fd.append("files", f);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error);
      setReview(body);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function commit() {
    if (!review) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/import/${review.stagingId}/commit`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error);
      setCommitted(body);
      setReview(null);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-xl font-semibold text-ink">Import art</h1>
      <p className="text-sm text-muted">
        Upload <code>.png</code>, <code>.tsx</code>, <code>.tsj</code>, <code>.json</code> catalogs, or a <code>.zip</code>. XML <code>.tsx</code> tilesets are
        parsed into <code>.tsj</code> automatically. ZIPs are extracted safely. Nothing is written until you commit.
      </p>

      <div className="card p-4 space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2"><label className="label">Pack name</label><input className="input" value={packName} onChange={(e) => setPackName(e.target.value)} placeholder="Office Interior" /></div>
          <div><label className="label">Tile size (opt.)</label><input className="input" value={tileSize} onChange={(e) => setTileSize(e.target.value)} placeholder="16" /></div>
        </div>
        <div><label className="label">License name (optional, shown prominently)</label><input className="input" value={licenseName} onChange={(e) => setLicenseName(e.target.value)} placeholder="CC0 / CC BY 4.0 / …" /></div>
        <div>
          <label className="label">Files</label>
          <input className="input" type="file" multiple onChange={(e) => setFiles(e.target.files)} accept=".png,.tsx,.tsj,.json,.zip" />
        </div>
        <button className="btn btn-accent" onClick={stage} disabled={busy || !files || !packName.trim()}>Stage & review</button>
        {err && <div className="text-sm text-danger">{err}</div>}
      </div>

      {review && (
        <div className="card p-4 space-y-3">
          <h2 className="font-medium text-ink">Review — {review.pack.name}</h2>
          {review.warnings.length > 0 && (
            <div className="space-y-1">
              {review.warnings.map((w, i) => (
                <div key={i} className="note note-warn">{w}</div>
              ))}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {review.tilesets.map((t, i) => (
              <div key={i} className="card p-3 bg-subtle flex gap-3 items-center">
                {t.previewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.previewUrl} alt="" className="pixelated h-10 w-10 object-contain" style={{ imageRendering: "pixelated" }} />
                )}
                <div className="text-sm">
                  <div className="text-ink">{t.name} <span className="chip ml-1">{t.kind}</span></div>
                  <div className="text-xs text-muted">{t.tileWidth}×{t.tileHeight}px · {t.tileCount} tiles · images {t.imagesPresent}/{t.imagesTotal}</div>
                  {t.placeable ? <span className="chip text-ok border-ok/40 mt-1">placeable</span> : <span className="chip text-warn border-warn/40 mt-1">hidden from /v1</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="text-xs text-muted">{review.looseImages} image(s), {review.assets} catalog asset(s) staged.</div>
          <button className="btn btn-accent" onClick={commit} disabled={busy}>Commit import</button>
        </div>
      )}

      {committed && (
        <div className="card p-4 space-y-2">
          <h2 className="font-medium text-ok">Imported into pack “{committed.packSlug}”</h2>
          <div className="text-sm text-ink">{committed.tilesetKeys.length} tileset(s), {committed.assetSlugs.length} asset(s).</div>
          {committed.warnings.map((w, i) => <div key={i} className="text-xs text-warn">{w}</div>)}
          <div className="flex gap-2">
            {committed.tilesetKeys.map((k) => <Link key={k} href={`/tilesets/${k}`} className="btn">Inspect {k}</Link>)}
          </div>
        </div>
      )}
    </div>
  );
}
