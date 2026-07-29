"use client";

import { BellIcon, PlusIcon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";
import { AccountMenu } from "./AccountMenu";
import { useOffices } from "./OfficesProvider";
import styles from "./SiteHeader.module.css";

/** The white Vorkium top bar. You reach the dashboard already signed in (via the
 *  game client's login), so it always shows the account controls. */
export function SiteHeader() {
  const { openCreate, openJoin } = useOffices();

  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        Vorkium
        <span className={styles.logoDot} aria-hidden />
      </div>

      <div className={styles.actions}>
        <ThemeToggle />
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
      </div>
    </header>
  );
}
