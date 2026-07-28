"use client";

import styles from "./StateSwitcher.module.css";

export type View = "default" | "empty" | "loading";

const OPTIONS: { id: View; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "empty", label: "Empty" },
  { id: "loading", label: "Loading" },
];

/**
 * Dev-only preview control to flip between the dashboard's three states.
 * Mirrors the states in the design; delete this once the view is data-driven.
 */
export function StateSwitcher({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className={styles.bar}>
      <span className={styles.label}>PREVIEW</span>
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          className={`${styles.opt} ${view === o.id ? styles.active : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
