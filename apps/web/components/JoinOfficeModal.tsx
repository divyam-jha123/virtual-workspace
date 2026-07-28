"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "./Modal";
import { useOffices } from "./OfficesProvider";
import styles from "./JoinOfficeModal.module.css";

export function JoinOfficeModal() {
  const { joinOpen, closeJoin, joinOffice } = useOffices();
  const [code, setCode] = useState("");

  const close = () => {
    setCode("");
    closeJoin();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    joinOffice(code);
    close();
  };

  return (
    <Modal
      open={joinOpen}
      onClose={close}
      title="Join an existing office"
      subtitle="Paste the invite code your teammate shared with you."
    >
      <form onSubmit={submit} className={styles.form}>
        <label className={styles.field}>
          <span className={styles.label}>Invite code</span>
          <input
            className={styles.input}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. ACME-24"
            autoFocus
            maxLength={24}
          />
        </label>

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={close}>
            Cancel
          </button>
          <button type="submit" className={styles.submit} disabled={!code.trim()}>
            Join office
          </button>
        </div>
      </form>
    </Modal>
  );
}
