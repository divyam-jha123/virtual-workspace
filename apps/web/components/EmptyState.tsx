"use client";

import { useOffices } from "./OfficesProvider";
import { PlusIcon } from "./icons";
import styles from "./EmptyState.module.css";

/* The little "spatial map" glyph: a lavender tile holding a grid of rounded
 * squares, with one orange + one green avatar dot near the centre. */
const B = "b"; // brand blue
const L = "l"; // light blue
const W = "w"; // white
const O = "o"; // orange dot
const G = "g"; // green dot
const PATTERN: string[][] = [
  [B, L, L, B, L, L],
  [L, W, W, W, W, L],
  [L, W, O, G, W, L],
  [B, L, L, L, L, B],
];

export function EmptyState() {
  const { openCreate, openJoin } = useOffices();

  return (
    <div className={styles.wrap}>
      <div className={styles.glyph}>
        <div className={styles.glyphGrid}>
          {PATTERN.flat().map((cell, i) => (
            <span key={i} className={`${styles.cell} ${styles[cell]}`} />
          ))}
        </div>
      </div>

      <h1 className={styles.title}>Your team&apos;s virtual office starts here</h1>
      <p className={styles.subtitle}>
        Spin up a spatial workspace where your team can walk
        <br />
        over, talk, and get things done — no scheduled call required.
      </p>

      <button className={styles.create} onClick={openCreate}>
        <PlusIcon size={20} />
        Create your office
      </button>

      <p className={styles.invite}>
        Have an invite code?{" "}
        <button className={styles.joinLink} onClick={openJoin}>
          Join with a code
        </button>
      </p>
    </div>
  );
}
