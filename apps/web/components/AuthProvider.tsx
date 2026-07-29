"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type SessionUser = { name: string; email: string };

/** You only reach the dashboard after signing in (via the game client's login),
 *  so it's always signed in. Real auth lives in apps/frontend/src/ui/auth. */
const DEFAULT_USER: SessionUser = { name: "Satyam Thakur", email: "satyam@vorkium.com" };
/** localStorage key for the demo session. */
export const SESSION_KEY = "vw.session";

type AuthContextValue = {
  user: SessionUser;
  firstName: string;
  initials: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

function toInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser>(DEFAULT_USER);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      // Ignore a stored "null" (a stale sign-out) — the dashboard is always signed in.
      if (raw && raw !== "null") {
        const u = JSON.parse(raw) as Partial<SessionUser>;
        if (u && u.name && u.email) setUser({ name: u.name, email: u.email });
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    } catch {
      /* ignore */
    }
  }, [user, hydrated]);

  const value: AuthContextValue = {
    user,
    firstName: user.name.trim().split(/\s+/)[0] ?? user.name,
    initials: toInitials(user.name),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
