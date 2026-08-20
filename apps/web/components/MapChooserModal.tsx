"use client";

import { Modal } from "./Modal";
import { useOffices } from "./OfficesProvider";
import { MAPS, enterMap } from "@/lib/maps";
import { ArrowRightIcon } from "./icons";
import styles from "@/styles/MapChooserModal.module.css";

export function MapChooserModal() {
  const { enteringOffice, closeMapChooser } = useOffices();

  return (
    <Modal
      open={enteringOffice !== null}
      onClose={closeMapChooser}
      title="Choose a map"
      subtitle={enteringOffice ? `Entering ${enteringOffice.name} — pick the space to drop into.` : undefined}
    >
      <div className={styles.list}>
        {MAPS.map((map) => (
          <button key={map.key} className={styles.map} onClick={() => enterMap(map.key)}>
            <span className={`${styles.thumb} ${styles[map.key]}`} aria-hidden>
              <span className={styles.grid} />
            </span>
            <span className={styles.meta}>
              <span className={styles.name}>{map.name}</span>
              <span className={styles.desc}>{map.description}</span>
            </span>
            <ArrowRightIcon size={18} className={styles.arrow} />
          </button>
        ))}
      </div>
    </Modal>
  );
}
