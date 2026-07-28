"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SESSION_KEY } from "@/components/AuthProvider";
import styles from "./login.module.css";

/** Turn an email local-part into a display name: "kr.satyam" → "Kr Satyam". */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] || "there";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const finish = (user: { name: string; email: string }) => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    } catch {
      /* ignore */
    }
    router.push("/");
  };

  const signIn = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    finish({ name: nameFromEmail(email.trim()), email: email.trim() });
  };

  const googleSignIn = () => finish({ name: "Meera Rao", email: "meera.rao@gmail.com" });

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.logo}>
          Vorkium
          <span className={styles.logoDot} aria-hidden />
        </div>
        <h1 className={styles.title}>Log in to your workspace</h1>
        <p className={styles.subtitle}>Welcome back — sign in to jump into your office.</p>

        <form onSubmit={signIn} className={styles.form}>
          <label className={styles.field}>
            <span className={styles.label}>Email</span>
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
              placeholder="you@company.com"
              autoFocus
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Password</span>
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              placeholder="••••••••"
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" className={styles.submit}>
            Sign in
          </button>
        </form>

        <div className={styles.divider}><span>or</span></div>

        <button type="button" className={styles.google} onClick={googleSignIn}>
          Continue with Google
        </button>
      </div>
    </div>
  );
}
