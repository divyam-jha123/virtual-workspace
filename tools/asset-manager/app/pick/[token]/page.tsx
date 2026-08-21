"use client";

import { useCallback, useEffect, useState } from "react";
import { getJSON, postJSON } from "../../lib/api";

interface Candidate {
  slug: string;
  name: string;
  category: string;
  subcategory: string | null;
  placement: string;
  widthTiles: number;
  heightTiles: number;
  tilesetKey: string | null;
  tags: string[];
  imageUrl: string | null;
}

interface Selection {
  token: string;
  prompt: string;
  status: "pending" | "chosen" | "cancelled" | "expired";
  chosenId: string | null;
  expiresAt: string;
  candidates: Candidate[];
}

function remaining(expiresAt: string): string {
  const seconds = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
  if (seconds === 0) return "expired";
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s left` : `${seconds}s left`;
}

export default function PickPage({ params }: { params: { token: string } }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      setSelection(await getJSON<Selection>(`/api/selections/${params.token}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [params.token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-render once a second so the countdown stays honest, and reload while
  // pending in case the question was answered or cancelled somewhere else.
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((n) => n + 1);
      if (selection?.status === "pending") void load();
    }, 1000);
    return () => clearInterval(timer);
  }, [selection?.status, load]);

  async function choose(slug: string) {
    setSubmitting(slug);
    try {
      await postJSON(`/api/selections/${params.token}/choose`, { assetId: slug });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(null);
    }
  }

  if (error && !selection) {
    return (
      <div className="max-w-lg">
        <h1 className="text-lg font-semibold mb-2">Selection unavailable</h1>
        <div className="note note-danger">{error}</div>
        <p className="text-sm text-muted mt-3">
          These links are short-lived. Ask again in the editor to get a new one.
        </p>
      </div>
    );
  }

  if (!selection) return <p className="text-sm text-muted">Loading…</p>;

  const done = selection.status !== "pending";
  const chosen = selection.candidates.find((c) => c.slug === selection.chosenId);

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-1">
        <h1 className="text-lg font-semibold tracking-tight">Choose art</h1>
        <span className="text-xs text-muted font-mono">{selection.token.slice(0, 8)}</span>
        {!done && <span className="ml-auto text-xs text-muted">{remaining(selection.expiresAt)}</span>}
      </div>
      <p className="text-sm text-muted mb-5">{selection.prompt}</p>

      {selection.status === "chosen" && (
        <div className="note note-ok mb-5">
          Picked {chosen ? `${chosen.name} (${chosen.slug})` : selection.chosenId}. You can close this tab — the editor
          has the answer.
        </div>
      )}
      {selection.status === "expired" && (
        <div className="note note-warn mb-5">This selection expired. Ask again in the editor for a fresh link.</div>
      )}
      {selection.status === "cancelled" && (
        <div className="note note-warn mb-5">This selection was cancelled in the editor.</div>
      )}
      {error && <div className="note note-danger mb-5">{error}</div>}

      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
        {selection.candidates.map((candidate) => {
          const isChosen = candidate.slug === selection.chosenId;
          return (
            <div
              key={candidate.slug}
              className={`card flex flex-col ${isChosen ? "border-accent" : ""}`}
            >
              <div className="h-24 flex items-center justify-center bg-subtle rounded-t-lg border-b border-line">
                {candidate.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={candidate.imageUrl}
                    alt={candidate.name}
                    className="pixelated max-h-20 max-w-[80%] object-contain"
                  />
                ) : (
                  <span className="text-xs text-muted">no preview</span>
                )}
              </div>

              <div className="p-3 flex flex-col gap-1 flex-1">
                <div className="font-medium leading-tight">{candidate.name}</div>
                <div className="text-xs text-muted font-mono break-all">{candidate.slug}</div>
                <div className="text-xs text-muted">
                  {candidate.widthTiles}&times;{candidate.heightTiles} tiles &middot; {candidate.placement}
                </div>

                <button
                  className={`btn w-full justify-center mt-2 ${isChosen ? "" : "btn-accent"}`}
                  disabled={done || submitting !== null}
                  onClick={() => void choose(candidate.slug)}
                >
                  {isChosen ? "Chosen" : submitting === candidate.slug ? "Choosing…" : "Choose"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {selection.candidates.length === 0 && (
        <div className="note note-warn">
          None of the offered assets are still in the library. Ask again in the editor.
        </div>
      )}
    </div>
  );
}
