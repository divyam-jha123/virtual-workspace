"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { LogOutIcon } from "./icons";
import { LOGIN_URL } from "@/lib/maps";
import styles from "./AccountMenu.module.css";

/** Navbar avatar that opens an account dropdown (name, email, Sign out). */
export function AccountMenu() {
  const { user, initials, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <div className={styles.wrap}>
      <button
        className={styles.avatar}
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
      >
        {initials}
      </button>

      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <div className={styles.menu} role="menu">
            <div className={styles.head}>
              <span className={styles.headAvatar}>{initials}</span>
              <div className={styles.who}>
                <span className={styles.name}>{user.name}</span>
                <span className={styles.email}>{user.email}</span>
              </div>
            </div>
            <div className={styles.sep} />
            <button
              className={styles.signout}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                signOut();
                window.location.href = LOGIN_URL;
              }}
            >
              <LogOutIcon size={16} />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
