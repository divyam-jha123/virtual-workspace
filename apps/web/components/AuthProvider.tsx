"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type SessionUser = { name: string; email: string };

/** Demo session. Real auth lives in the game client (apps/frontend/src/ui/auth);
 *  the dashboard just reflects who's signed in and offers sign-out / log-in. */
const DEFAULT_USER: SessionUser = { name: "Satyam Thakur", email: "satyam@vorkium.com" };
/** localStorage key for the demo session, shared with the /login page. */
export const SESSION_KEY = "vw.session";
const KEY = SESSION_KEY;

type AuthContextValue = {
  user: SessionUser | null;
  firstName: string;
  initials: string;
  signOut: () => void;
  signIn: () => void;
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
  const [user, setUser] = useState<SessionUser | null>(DEFAULT_USER);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === "null") setUser(null);
      else if (raw) setUser(JSON.parse(raw) as SessionUser);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(KEY, user ? JSON.stringify(user) : "null");
    } catch {
      /* ignore */
    }
  }, [user, hydrated]);

  const value: AuthContextValue = {
    user,
    firstName: user ? user.name.trim().split(/\s+/)[0] ?? user.name : "",
    initials: user ? toInitials(user.name) : "",
    signOut: () => setUser(null),
    signIn: () => setUser(DEFAULT_USER),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
