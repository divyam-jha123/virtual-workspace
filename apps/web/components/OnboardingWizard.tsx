"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import {
  AVATAR_SWATCHES,
  HEARD_FROM,
  INTENTS,
  ROLES,
  TEAM_SIZES,
  TIMEZONES,
  deriveCompanyFromEmail,
  gradientForAvatar,
  isOnboarded,
  nameFromEmail,
  saveProfile,
  type Intent,
  type OnboardingProfile,
  type Role,
  type TeamSize,
} from "@/lib/onboarding";
import styles from "./OnboardingWizard.module.css";

const TOTAL_STEPS = 5;

type Draft = {
  displayName: string;
  avatar: string;
  role: Role | null;
  roleOther: string;
  companyName: string;
  teamSize: TeamSize | null;
  timezone: string;
  workStart: string;
  workEnd: string;
  intent: Intent | null;
  heardFrom: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase() || "?";
}

/** The post-login questionnaire. Prefills from the login handoff, persists per
 *  account, then hands off to the dashboard. */
export function OnboardingWizard() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const emailName = nameFromEmail(user.email);

  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({
    displayName: "",
    avatar: AVATAR_SWATCHES[0].key,
    role: null,
    roleOther: "",
    companyName: "",
    teamSize: null,
    timezone: "Asia/Kolkata",
    workStart: "",
    workEnd: "",
    intent: null,
    heardFrom: "",
  });

  // Prefill once the session resolves: name derived from the work email, company
  // guessed from its domain. Already-onboarded accounts skip to the dashboard.
  useEffect(() => {
    if (!ready) return;
    if (user.email && isOnboarded(user.email)) {
      router.replace("/");
      return;
    }
    setDraft((d) => ({
      ...d,
      displayName: d.displayName || nameFromEmail(user.email),
      companyName: d.companyName || deriveCompanyFromEmail(user.email),
    }));
  }, [ready, user.email, router]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Per-step gate for the Continue button. The last step is skippable → always ok.
  const canContinue = useMemo(() => {
    switch (step) {
      case 0:
        return draft.displayName.trim().length > 0;
      case 1:
        // If "Other", they must say what they do.
        return draft.role !== null && (draft.role !== "other" || draft.roleOther.trim().length > 0);
      case 2:
        return draft.companyName.trim().length > 0 && draft.teamSize !== null;
      case 3:
        return draft.intent !== null;
      default:
        return true;
    }
  }, [step, draft]);

  const finish = () => {
    const profile: OnboardingProfile = {
      displayName: draft.displayName.trim(),
      email: user.email,
      avatar: draft.avatar,
      role: draft.role,
      roleOther: draft.role === "other" ? draft.roleOther.trim() : "",
      companyName: draft.companyName.trim(),
      teamSize: draft.teamSize,
      timezone: draft.timezone,
      workStart: draft.workStart,
      workEnd: draft.workEnd,
      intent: draft.intent,
      heardFrom: draft.heardFrom,
      completedAt: new Date().toISOString(),
    };
    saveProfile(user.email, profile);
    router.replace("/");
  };

  const next = () => {
    if (step < TOTAL_STEPS - 1) setStep((s) => s + 1);
    else finish();
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const onInput =
    (key: keyof Draft) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      set(key, e.target.value as Draft[typeof key]);

  return (
    <div className={styles.screen}>
      <div className={styles.bar}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.logo} src="/vorkium-logo.png" alt="Vorkium" />
        <div className={styles.progress}>
          <div
            className={styles.progressFill}
            style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
          />
        </div>
        <span className={styles.stepCount}>
          Step {step + 1} of {TOTAL_STEPS}
        </span>
      </div>

      <div className={styles.body}>
        <div className={styles.card}>
          {/* ---- Step 1: Who you are ---- */}
          {step === 0 && (
            <>
              <p className={styles.eyebrow}>Who you are</p>
              <h1 className={styles.title}>
                Welcome{emailName ? `, ${emailName}` : ""} — let&rsquo;s set up your space
              </h1>
              <p className={styles.subtitle}>
                This is how teammates will see you inside the office.
              </p>

              <div className={styles.fields}>
                <div className={styles.field}>
                  <label htmlFor="displayName">Display name</label>
                  <input
                    id="displayName"
                    className={styles.input}
                    placeholder="e.g. Ankit Sharma"
                    value={draft.displayName}
                    onChange={onInput("displayName")}
                    autoFocus
                  />
                </div>

                <div className={styles.field}>
                  <label>Pick an avatar colour</label>
                  <div className={styles.avatarRow}>
                    <div
                      className={styles.avatarPreview}
                      style={{ background: gradientForAvatar(draft.avatar) }}
                    >
                      {initials(draft.displayName || emailName)}
                    </div>
                    <div className={styles.swatches}>
                      {AVATAR_SWATCHES.map((s) => (
                        <button
                          key={s.key}
                          type="button"
                          aria-label={`Avatar ${s.key}`}
                          className={`${styles.swatch} ${draft.avatar === s.key ? styles.swatchOn : ""}`}
                          style={{ background: s.gradient }}
                          onClick={() => set("avatar", s.key)}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="email">Work email</label>
                  <input
                    id="email"
                    className={styles.input}
                    value={user.email || ""}
                    disabled
                  />
                  <p className={styles.help}>Verified at sign-in — we use its domain for your company.</p>
                </div>
              </div>
            </>
          )}

          {/* ---- Step 2: Role ---- */}
          {step === 1 && (
            <>
              <p className={styles.eyebrow}>Your role</p>
              <h1 className={styles.title}>What do you do?</h1>
              <p className={styles.subtitle}>
                We&rsquo;ll tailor default permissions and the tips you see in the lobby.
              </p>

              <div className={`${styles.options} ${styles.optionsTwo}`}>
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    className={`${styles.option} ${draft.role === r.value ? styles.optionOn : ""}`}
                    onClick={() => set("role", r.value)}
                  >
                    <span className={styles.radio} aria-hidden />
                    <span className={styles.optionText}>
                      <span className={styles.optionLabel}>{r.label}</span>
                    </span>
                  </button>
                ))}
              </div>

              {draft.role === "other" && (
                <div className={styles.field} style={{ marginTop: 16 }}>
                  <label htmlFor="roleOther">Tell us your role</label>
                  <input
                    id="roleOther"
                    className={styles.input}
                    placeholder="e.g. Product Manager"
                    value={draft.roleOther}
                    onChange={onInput("roleOther")}
                    autoFocus
                  />
                </div>
              )}
            </>
          )}

          {/* ---- Step 3: Context ---- */}
          {step === 2 && (
            <>
              <p className={styles.eyebrow}>Your team</p>
              <h1 className={styles.title}>Tell us about your workspace</h1>
              <p className={styles.subtitle}>A little context so the office feels right for your team.</p>

              <div className={styles.fields}>
                <div className={styles.field}>
                  <label htmlFor="company">Company name</label>
                  <input
                    id="company"
                    className={styles.input}
                    placeholder="e.g. Acme Inc."
                    value={draft.companyName}
                    onChange={onInput("companyName")}
                  />
                </div>

                <div className={styles.field}>
                  <label>Team size</label>
                  <div className={`${styles.options} ${styles.optionsTwo}`} style={{ marginTop: 0 }}>
                    {TEAM_SIZES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        className={`${styles.option} ${draft.teamSize === t.value ? styles.optionOn : ""}`}
                        onClick={() => set("teamSize", t.value)}
                      >
                        <span className={styles.radio} aria-hidden />
                        <span className={styles.optionText}>
                          <span className={styles.optionLabel}>{t.label}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="tz">Timezone</label>
                  <select
                    id="tz"
                    className={styles.select}
                    value={draft.timezone}
                    onChange={onInput("timezone")}
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.field}>
                  <label>
                    Working hours <span className={styles.hintText}>· optional</span>
                  </label>
                  <div className={styles.row}>
                    <input
                      type="time"
                      className={styles.input}
                      aria-label="Working hours start"
                      value={draft.workStart}
                      onChange={onInput("workStart")}
                    />
                    <input
                      type="time"
                      className={styles.input}
                      aria-label="Working hours end"
                      value={draft.workEnd}
                      onChange={onInput("workEnd")}
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ---- Step 4: Intent ---- */}
          {step === 3 && (
            <>
              <p className={styles.eyebrow}>Your goal</p>
              <h1 className={styles.title}>What brings you to Vorkium?</h1>
              <p className={styles.subtitle}>
                This shapes what your lobby nudges you toward first.
              </p>

              <div className={styles.options}>
                {INTENTS.map((i) => (
                  <button
                    key={i.value}
                    type="button"
                    className={`${styles.option} ${draft.intent === i.value ? styles.optionOn : ""}`}
                    onClick={() => set("intent", i.value)}
                  >
                    <span className={styles.radio} aria-hidden />
                    <span className={styles.optionText}>
                      <span className={styles.optionLabel}>{i.label}</span>
                      <span className={styles.optionHint}>{i.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ---- Step 5: How did you hear about us (skippable) ---- */}
          {step === 4 && (
            <>
              <p className={styles.eyebrow}>Last one</p>
              <h1 className={styles.title}>How did you hear about Vorkium?</h1>
              <p className={styles.subtitle}>Totally optional — it just helps us out.</p>

              <div className={styles.options}>
                {HEARD_FROM.map((h) => (
                  <button
                    key={h.value}
                    type="button"
                    className={`${styles.option} ${draft.heardFrom === h.value ? styles.optionOn : ""}`}
                    onClick={() => set("heardFrom", h.value)}
                  >
                    <span className={styles.radio} aria-hidden />
                    <span className={styles.optionText}>
                      <span className={styles.optionLabel}>{h.label}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className={styles.footer}>
            {step > 0 && (
              <button type="button" className={styles.back} onClick={back}>
                <BackArrow />
                Back
              </button>
            )}
            <span className={styles.spacer} />
            {step === TOTAL_STEPS - 1 && (
              <button type="button" className={styles.skip} onClick={finish}>
                Skip
              </button>
            )}
            <button
              type="button"
              className={styles.next}
              onClick={next}
              disabled={!canContinue}
            >
              {step === TOTAL_STEPS - 1 ? "Go to dashboard" : "Continue"}
              {step < TOTAL_STEPS - 1 && <NextArrow />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NextArrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function BackArrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}
