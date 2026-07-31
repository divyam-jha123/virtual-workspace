"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type SessionUser = { name: string; email: string };

/** Fallback identity for a direct visit with no login info yet. */
const DEFAULT_USER: SessionUser = { name: "there", email: "" };
/** localStorage key for the session, shared with the game-login handoff. */
export const SESSION_KEY = "vw.session";

type AuthContextValue = {
  user: SessionUser;
  firstName: string;
  initials: string;
  /** True once the session has been resolved (from the login handoff or storage). */
  ready: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

/** Turn "kr.satyam" → "Kr Satyam"; used to make a friendly name from an email. */
function titleCase(local: string): string {
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

/** The game account's display name defaults to the email for email-code signups.
 *  When it looks like an email, derive a friendly name from the local part. */
function friendlyName(name: string, email: string): string {
  const n = name.trim();
  if (!n || n.includes("@")) {
    const local = (email || n).split("@")[0];
    return titleCase(local) || "there";
  }
  return n;
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
      // 1) Prefer name/email handed over by the game login redirect (?name&email).
      const params = new URLSearchParams(window.location.search);
      const email = params.get("email");
      if (email) {
        const next: SessionUser = {
          name: friendlyName(params.get("name") ?? email, email),
          email,
        };
        setUser(next);
        localStorage.setItem(SESSION_KEY, JSON.stringify(next));
        // Strip the params so they don't linger in the address bar.
        params.delete("name");
        params.delete("email");
        const qs = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      } else {
        // 2) Otherwise use the stored session.
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw && raw !== "null") {
          const u = JSON.parse(raw) as Partial<SessionUser>;
          if (u && u.name && u.email) setUser({ name: u.name, email: u.email });
        }
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
    ready: hydrated,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
