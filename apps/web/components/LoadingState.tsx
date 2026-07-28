import styles from "./LoadingState.module.css";

/** Skeleton mirror of the Default view, shown while offices are being fetched. */
export function LoadingState() {
  return (
    <div className={styles.wrap}>
      <div className={styles.top}>
        <div>
          <div className={`${styles.sk} ${styles.greeting}`} />
          <div className={`${styles.sk} ${styles.sub}`} />
        </div>
        <div className={`${styles.sk} ${styles.search}`} />
      </div>

      <div className={styles.sectionHead}>
        <div className={`${styles.sk} ${styles.sectionTitle}`} />
        <div className={`${styles.sk} ${styles.count}`} />
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
