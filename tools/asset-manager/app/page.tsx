"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { del, getJSON, postJSON } from "./lib/api";

interface Pack {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  tileSize?: number | null;
  nonPlaceableWarning: boolean;
  assetCount: number;
  tilesetCount: number;
  license?: { name: string } | null;
}

export default function PacksPage() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setPacks((await getJSON<{ items: Pack[] }>("/api/packs")).items);
  }
  useEffect(() => {
    load().catch((e) => setMsg(String(e)));
  }, []);

  async function createPack() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await postJSON("/api/packs", { name });
      setName("");
      await load();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function vendorAll() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postJSON<{ tilesets: string[]; assets: string[]; warnings: string[] }>("/api/vendor", {});
      setMsg(`Vendored ${r.tilesets.length} tileset(s) and ${r.assets.length} asset(s) into content/. ${r.warnings.join(" ")}`);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-ink">Packs</h1>
        <button className="btn btn-accent ml-auto" onClick={vendorAll} disabled={busy}>
          ⤓ Vendor all → content/
        </button>
      </div>

      {msg && <div className="card p-3 text-sm text-ink">{msg}</div>}

      <div className="card p-4 flex gap-2 items-end">
        <div className="flex-1">
          <label className="label">New pack name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Office Interior" />
        </div>
        <button className="btn" onClick={createPack} disabled={busy || !name.trim()}>
          + Create pack
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {packs.map((p) => (
          <div key={p.id} className="card p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between">
              <Link href={`/packs/${p.id}`} className="font-medium text-ink hover:text-accent">
                {p.name}
              </Link>
              <button
                className="text-muted hover:text-danger text-xs"
                onClick={async () => {
                  if (confirm(`Delete pack "${p.name}" and all its assets?`)) {
                    await del(`/api/packs/${p.id}`);
                    await load();
                  }
                }}
              >
                Remove
              </button>
            </div>
            {p.description && <p className="text-xs text-muted line-clamp-2">{p.description}</p>}
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="chip">{p.tilesetCount} tilesets</span>
              <span className="chip">{p.assetCount} assets</span>
              {p.license && <span className="chip">{p.license.name}</span>}
            </div>
            {p.nonPlaceableWarning && (
              <div className="note note-warn text-xs">
                {p.tileSize}px pack — excluded from /v1 (MCP never sees it)
              </div>
            )}
          </div>
        ))}
        {packs.length === 0 && <p className="text-muted text-sm">No packs yet. Create one, or use the Import tab.</p>}
      </div>
    </div>
  );
}
