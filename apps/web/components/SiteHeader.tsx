"use client";

import { BellIcon, PlusIcon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";
import { AccountMenu } from "./AccountMenu";
import { useOffices } from "./OfficesProvider";
import { useAuth } from "./AuthProvider";
import { LOGIN_URL } from "@/lib/maps";
import styles from "./SiteHeader.module.css";

/** The white Vorkium top bar. Signed in: theme toggle, account menu, notifications,
 *  "Join with code" and "Create your office". Signed out: theme toggle + "Log in"
 *  (goes to the game client's login). */
export function SiteHeader() {
  const { openCreate, openJoin } = useOffices();
  const { user } = useAuth();

  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        Vorkium
        <span className={styles.logoDot} aria-hidden />
      </div>

      <div className={styles.actions}>
        <ThemeToggle />

        {user ? (
          <>
            <AccountMenu />

            <button className={styles.bell} aria-label="Notifications">
              <BellIcon size={20} />
              <span className={styles.bellDot} aria-hidden />
            </button>

            <button className={styles.join} onClick={openJoin}>
              Join with code
            </button>

            <button className={styles.create} onClick={openCreate}>
              <PlusIcon size={20} />
              Create your office
            </button>
          </>
        ) : (
          <button className={styles.login} onClick={() => (window.location.href = LOGIN_URL)}>
            Log in
          </button>
        )}
      </div>
    </header>
  );
}
