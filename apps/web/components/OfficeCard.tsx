"use client";

import { useState } from "react";
import type { Office } from "@/lib/offices";
import { useOffices } from "./OfficesProvider";
import { ArrowRightIcon, DotsIcon, PlusIcon, TrashIcon } from "./icons";
import styles from "./OfficeCard.module.css";

export function OfficeCard({ office }: { office: Office }) {
  const { removeOffice, openMapChooser } = useOffices();
  const [menuOpen, setMenuOpen] = useState(false);
  const hasOnline = office.online > 0;

  return (
    <article className={styles.card}>
      <div className={`${styles.preview} ${styles[office.theme]}`}>
        <div className={styles.grid} aria-hidden />
        {hasOnline && (
          <span className={styles.onlinePill}>
            <span className={styles.onlineDot} aria-hidden />
            {office.online} online
          </span>
        )}
        <span className={styles.previewTag}>// map preview</span>
      </div>

      <div className={styles.body}>
        <div className={styles.head}>
          <div>
            <h3 className={styles.name}>{office.name}</h3>
            <p className={styles.org}>{office.org}</p>
          </div>

          <div className={styles.menuWrap}>
            <button
              className={styles.menu}
              aria-label="Office options"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <DotsIcon size={20} />
            </button>
            {menuOpen && (
              <>
                <div className={styles.menuBackdrop} onClick={() => setMenuOpen(false)} />
                <div className={styles.dropdown} role="menu">
                  <button
                    className={styles.delete}
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      removeOffice(office.id);
                    }}
                  >
                    <TrashIcon size={16} />
                    Delete office
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className={styles.foot}>
          {hasOnline ? (
            <div className={styles.stack}>
              {office.members.map((m) => (
                <span
                  key={m.initials}
                  className={styles.memberAvatar}
                  style={{ background: m.color }}
                >
                  {m.initials}
                </span>
              ))}
              {office.overflow ? (
                <span className={`${styles.memberAvatar} ${styles.overflow}`}>
                  +{office.overflow}
                </span>
              ) : null}
            </div>
          ) : (
            <span className={styles.empty}>No one&apos;s in right now</span>
          )}

          <button className={styles.enter} onClick={() => openMapChooser(office)}>
            Enter office
            <ArrowRightIcon size={18} />
          </button>
        </div>
      </div>
    </article>
  );
}

/** The dashed "add another office" tile that closes the grid. */
export function NewOfficeCard() {
  const { openCreate } = useOffices();
  return (
    <button className={styles.newCard} onClick={openCreate}>
      <span className={styles.newIcon}>
        <PlusIcon size={22} />
      </span>
      <span className={styles.newLabel}>New office</span>
    </button>
  );
}
