"use client";

import { useEffect, useState } from "react";
import { del, getJSON, postJSON } from "../lib/api";

interface License {
  id: string; name: string; licenseName?: string | null; licenseUrl?: string | null;
  author?: string | null; sourceUrl?: string | null;
  attributionRequired: boolean; commercialUseAllowed: boolean; redistributionAllowed: boolean; notes?: string | null;
}

export default function LicensesPage() {
  const [items, setItems] = useState<License[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() { setItems((await getJSON<{ items: License[] }>("/api/licenses")).items); }
  useEffect(() => { load().catch((e) => setMsg(String(e))); }, []);

  async function create() {
    if (!name.trim()) return;
    await postJSON("/api/licenses", { name, licenseName: name, licenseUrl: url || undefined });
    setName(""); setUrl(""); await load();
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-xl font-semibold text-ink">Licenses</h1>
      <p className="text-sm text-muted">Stored and displayed prominently on assets. Never enforced or blocked — attribution is your responsibility.</p>
      <div className="card p-4 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[12rem]"><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="CC BY 4.0" /></div>
        <div className="flex-1 min-w-[12rem]"><label className="label">URL</label><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>
        <button className="btn" onClick={create}>+ Add</button>
      </div>
      {msg && <div className="text-sm text-danger">{msg}</div>}
      <div className="card divide-y divide-line">
        {items.map((l) => (
          <div key={l.id} className="px-3 py-2 flex items-center gap-3">
            <div className="flex-1">
              <div className="text-sm text-ink">{l.licenseName ?? l.name}</div>
              {l.licenseUrl && <a href={l.licenseUrl} target="_blank" rel="noreferrer" className="text-xs text-accent">{l.licenseUrl}</a>}
              {l.notes && <div className="text-xs text-muted">{l.notes}</div>}
            </div>
            <span className="chip">{l.attributionRequired ? "attribution" : "no attribution"}</span>
            <span className="chip">{l.commercialUseAllowed ? "commercial" : "non-commercial"}</span>
            <button className="text-muted hover:text-danger text-xs" onClick={async () => { await del(`/api/licenses/${l.id}`); await load(); }}>Remove</button>
          </div>
        ))}
        {items.length === 0 && <div className="px-3 py-4 text-sm text-muted">No licenses yet.</div>}
      </div>
    </div>
  );
}
