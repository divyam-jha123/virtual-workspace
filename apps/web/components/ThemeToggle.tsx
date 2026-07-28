"use client";

import { MoonIcon, SunIcon } from "./icons";
import styles from "./ThemeToggle.module.css";

/**
 * Flips the light/dark theme by toggling `data-theme` on <html> and persisting
 * the choice. The icon is swapped purely in CSS off that attribute, so there's
 * no React state to hydrate and no theme flash. The initial attribute is set by
 * the inline script in the root layout (before paint).
 */
export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("vw-theme", next);
    } catch {
      /* storage blocked — theme still applies for this session */
    }
  };

  return (
    <button className={styles.toggle} onClick={toggle} aria-label="Toggle dark mode">
      <MoonIcon size={18} className={styles.moon} />
      <SunIcon size={18} className={styles.sun} />
    </button>
  );
}
