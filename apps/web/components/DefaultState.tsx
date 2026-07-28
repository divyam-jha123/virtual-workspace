"use client";

import { useOffices } from "./OfficesProvider";
import { useAuth } from "./AuthProvider";
import { OfficeCard, NewOfficeCard } from "./OfficeCard";
import { SearchIcon } from "./icons";
import styles from "./DefaultState.module.css";

/** The returning-user view: greeting, search, and the grid of joinable offices. */
export function DefaultState() {
  const { offices } = useOffices();
  const { firstName } = useAuth();

  return (
    <div className={styles.wrap}>
      <div className={styles.top}>
        <div>
          <h1 className={styles.greeting}>Welcome back, {firstName || "there"}</h1>
          <p className={styles.sub}>Jump back into your office or build a new one.</p>
        </div>

        <div className={styles.search}>
          <SearchIcon size={20} className={styles.searchIcon} />
          <input placeholder="Search offices" aria-label="Search offices" />
        </div>
      </div>

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Your offices</h2>
        <span className={styles.count}>{offices.length}</span>
      </div>

      <div className={styles.grid}>
        {offices.map((office) => (
          <OfficeCard key={office.id} office={office} />
        ))}
        <NewOfficeCard />
      </div>
    </div>
  );
}
