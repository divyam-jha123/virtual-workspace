"use client";

import { useState } from "react";
import { AuthProvider } from "@/components/AuthProvider";
import { OfficesProvider } from "@/components/OfficesProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { DefaultState } from "@/components/DefaultState";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { StateSwitcher, type View } from "@/components/StateSwitcher";
import { CreateOfficeModal } from "@/components/CreateOfficeModal";
import { MapChooserModal } from "@/components/MapChooserModal";
import styles from "./page.module.css";

export default function LobbyPage() {
  const [view, setView] = useState<View>("default");

  return (
    <AuthProvider>
      <OfficesProvider>
        <div className={styles.page}>
          <SiteHeader />
          <main className={styles.content}>
            {view === "default" && <DefaultState />}
            {view === "empty" && <EmptyState />}
            {view === "loading" && <LoadingState />}
          </main>
          <StateSwitcher view={view} onChange={setView} />

          <CreateOfficeModal />
          <MapChooserModal />
        </div>
      </OfficesProvider>
    </AuthProvider>
  );
}
