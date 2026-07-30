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

const STORAGE_KEY = "vw.offices";

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
  // Seed on server + first client render (keeps hydration stable), then load any
  // saved offices from localStorage on mount. `hydrated` is STATE (not a ref) so
  // the persist effect below reliably skips the first commit — otherwise it would
  // write the seed back over saved data (e.g. undoing a delete on refresh).
  const [offices, setOffices] = useState<Office[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setOffices(JSON.parse(raw) as Office[]);
    } catch {
      /* ignore unreadable storage */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return; // don't clobber saved data with the seed
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(offices));
    } catch {
      /* ignore */
    }
  }, [offices, hydrated]);

  const addOffice = useCallback((draft: NewOffice) => {
    const office: Office = {
      id: slugify(draft.name),
      name: draft.name.trim(),
      org: draft.org.trim() || "Your workspace",
      theme: draft.theme,
      online: 0,
      members: [],
    };
    setOffices((prev) => [...prev, office]);
  }, []);

  const removeOffice = useCallback((id: string) => {
    setOffices((prev) => prev.filter((o) => o.id !== id));
  }, []);

  const joinOffice = useCallback((code: string) => {
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
    setOffices((prev) => [...prev, office]);
  }, []);

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
