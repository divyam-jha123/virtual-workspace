"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { type Office } from "@/lib/offices";
import { useAuth } from "./AuthProvider";

type NewOffice = { name: string; org: string; theme: Office["theme"] };

type OfficesContextValue = {
  offices: Office[];
  /** False until localStorage has been read — gate content to avoid a flash. */
  hydrated: boolean;
  addOffice: (draft: NewOffice) => void;
  removeOffice: (id: string) => void;
  joinOffice: (code: string) => void;

  /** Create-office dialog. */
  createOpen: boolean;
  openCreate: () => void;
  closeCreate: () => void;

  /** Join-by-code dialog. */
  joinOpen: boolean;
  openJoin: () => void;
  closeJoin: () => void;

  /** Map-chooser dialog (opened by "Enter office"); tracks which office. */
  enteringOffice: Office | null;
  openMapChooser: (office: Office) => void;
  closeMapChooser: () => void;
};

const OfficesContext = createContext<OfficesContextValue | null>(null);

export function useOffices(): OfficesContextValue {
  const ctx = useContext(OfficesContext);
  if (!ctx) throw new Error("useOffices must be used within <OfficesProvider>");
  return ctx;
}

function slugify(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base || "office"}-${Math.random().toString(36).slice(2, 7)}`;
}

export function OfficesProvider({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  // Offices are scoped to the signed-in account, so a different (or fresh) user
  // starts empty — and the old un-scoped "vw.offices" key is ignored. `null`
  // while we don't yet know who's signed in.
  const storageKey = user.email ? `vw.offices:${user.email}` : null;

  const [offices, setOffices] = useState<Office[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // (Re)load this account's offices once auth resolves or the user changes.
  useEffect(() => {
    if (!ready) return; // wait until we know who's signed in
    let next: Office[] = [];
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) next = JSON.parse(raw) as Office[];
      } catch {
        /* ignore unreadable storage */
      }
    }
    setOffices(next);
    setHydrated(true);
  }, [storageKey, ready]);

  const persist = useCallback(
    (next: Office[]) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const addOffice = useCallback(
    (draft: NewOffice) => {
      const office: Office = {
        id: slugify(draft.name),
        name: draft.name.trim(),
        org: draft.org.trim() || "Your workspace",
        theme: draft.theme,
        online: 0,
        members: [],
      };
      const next = [...offices, office];
      setOffices(next);
      persist(next);
    },
    [offices, persist],
  );

  const removeOffice = useCallback(
    (id: string) => {
      const next = offices.filter((o) => o.id !== id);
      setOffices(next);
      persist(next);
    },
    [offices, persist],
  );

  const joinOffice = useCallback(
    (code: string) => {
      const c = code.trim();
      const themes: Office["theme"][] = ["blue", "orange", "green"];
      const office: Office = {
        id: slugify(c || "office"),
        name: c.toUpperCase() || "Shared office",
        org: "Joined via code",
        theme: themes[Math.floor(Math.random() * themes.length)],
        online: 0,
        members: [],
      };
      const next = [...offices, office];
      setOffices(next);
      persist(next);
    },
    [offices, persist],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [enteringOffice, setEnteringOffice] = useState<Office | null>(null);

  const value: OfficesContextValue = {
    offices,
    hydrated,
    addOffice,
    removeOffice,
    joinOffice,
    createOpen,
    openCreate: () => setCreateOpen(true),
    closeCreate: () => setCreateOpen(false),
    joinOpen,
    openJoin: () => setJoinOpen(true),
    closeJoin: () => setJoinOpen(false),
    enteringOffice,
    openMapChooser: (office) => setEnteringOffice(office),
    closeMapChooser: () => setEnteringOffice(null),
  };

  return <OfficesContext.Provider value={value}>{children}</OfficesContext.Provider>;
}
