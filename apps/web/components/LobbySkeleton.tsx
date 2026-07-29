import styles from "./LobbySkeleton.module.css";

/** Shown for the one tick before localStorage is read, so refresh never flashes
 *  the wrong (default/server) state. Mirrors the Default layout to avoid a jump. */
export function LobbySkeleton() {
  return (
    <div className={styles.wrap} aria-hidden>
      <div className={styles.top}>
        <div>
          <div className={`${styles.sk} ${styles.greeting}`} />
          <div className={`${styles.sk} ${styles.sub}`} />
        </div>
        <div className={`${styles.sk} ${styles.search}`} />
      </div>

      <div className={styles.sectionHead}>
        <div className={`${styles.sk} ${styles.sectionTitle}`} />
      </div>

      <div className={styles.grid}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.card}>
            <div className={`${styles.sk} ${styles.preview}`} />
            <div className={styles.body}>
              <div className={`${styles.sk} ${styles.name}`} />
              <div className={`${styles.sk} ${styles.org}`} />
              <div className={styles.foot}>
                <div className={`${styles.sk} ${styles.stack}`} />
                <div className={`${styles.sk} ${styles.btn}`} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
