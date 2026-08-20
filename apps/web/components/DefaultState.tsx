"use client";

import { useMemo, useState } from "react";
import { useOffices } from "./OfficesProvider";
import { useAuth } from "./AuthProvider";
import { OfficeCard, NewOfficeCard } from "./OfficeCard";
import { SearchIcon } from "./icons";
import styles from "@/styles/DefaultState.module.css";

/** The returning-user view: greeting, search, and the grid of joinable offices. */
export function DefaultState() {
  const { offices } = useOffices();
  const { firstName } = useAuth();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? offices.filter(
            (o) =>
              o.name.toLowerCase().includes(q) || o.org.toLowerCase().includes(q),
          )
        : offices,
    [offices, q],
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.top}>
        <div>
          <h1 className={styles.greeting}>Welcome back, {firstName}</h1>
          <p className={styles.sub}>Jump back into your office or build a new one.</p>
        </div>

        <div className={styles.search}>
          <SearchIcon size={20} className={styles.searchIcon} />
          <input
            placeholder="Search offices"
            aria-label="Search offices"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Your offices</h2>
        <span className={styles.count}>{filtered.length}</span>
      </div>

      {q && filtered.length === 0 ? (
        <p className={styles.empty}>No offices match &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <div className={styles.grid}>
          {filtered.map((office) => (
            <OfficeCard key={office.id} office={office} />
          ))}
          {/* Only offer "create" when browsing the full list, not filtered results. */}
          {!q && <NewOfficeCard />}
        </div>
      )}
    </div>
  );
}
