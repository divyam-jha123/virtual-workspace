"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "./Modal";
import { useOffices } from "./OfficesProvider";
import type { Office } from "@/lib/offices";
import styles from "./CreateOfficeModal.module.css";

const THEMES: { id: Office["theme"]; label: string }[] = [
  { id: "blue", label: "Blue" },
  { id: "orange", label: "Orange" },
  { id: "green", label: "Green" },
];

export function CreateOfficeModal() {
  const { createOpen, closeCreate, addOffice } = useOffices();
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [theme, setTheme] = useState<Office["theme"]>("blue");

  const reset = () => {
    setName("");
    setOrg("");
    setTheme("blue");
  };
  const close = () => {
    reset();
    closeCreate();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    addOffice({ name, org, theme });
    close();
  };

  return (
    <Modal open={createOpen} onClose={close} title="Create your office" subtitle="Give it a name and pick a look. You can enter and choose a map after.">
      <form onSubmit={submit} className={styles.form}>
        <label className={styles.field}>
          <span className={styles.label}>Office name</span>
          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Engineering Floor"
            autoFocus
            maxLength={40}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Organisation <span className={styles.optional}>(optional)</span></span>
          <input
            className={styles.input}
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="e.g. Zylker Technologies"
            maxLength={40}
          />
        </label>

        <div className={styles.field}>
          <span className={styles.label}>Theme</span>
          <div className={styles.themes}>
            {THEMES.map((t) => (
              <button
                type="button"
                key={t.id}
                className={`${styles.swatch} ${styles[t.id]} ${theme === t.id ? styles.selected : ""}`}
                onClick={() => setTheme(t.id)}
                aria-label={t.label}
                aria-pressed={theme === t.id}
              />
            ))}
          </div>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={close}>
            Cancel
          </button>
          <button type="submit" className={styles.submit} disabled={!name.trim()}>
            Create office
          </button>
        </div>
      </form>
    </Modal>
  );
}
