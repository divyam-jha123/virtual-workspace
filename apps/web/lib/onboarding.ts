/** Post-login onboarding: a short questionnaire between Divyam's login and the
 *  dashboard. Answers are persisted per signed-in account in localStorage (there
 *  is no backend yet — this is the frontend slice), scoped just like offices.
 *
 *  Guiding rule (from the flow board): only ask what changes what the user sees
 *  next, or what we can't infer. Everything else lives in settings later. */

export type Role =
  | "founder"
  | "engineering"
  | "design"
  | "sales"
  | "people"
  | "support"
  | "other";

export type TeamSize = "1-10" | "11-50" | "51-200" | "200+";

export type Intent =
  | "daily-office"
  | "meetings"
  | "events"
  | "onboarding"
  | "exploring";

export type OnboardingProfile = {
  displayName: string;
  email: string;
  /** Key into AVATAR_SWATCHES — the account avatar's accent. */
  avatar: string;
  role: Role | null;
  /** Free-text role, only when `role === "other"`. */
  roleOther: string;
  companyName: string;
  teamSize: TeamSize | null;
  timezone: string;
  workStart: string; // "09:00"
  workEnd: string; // "18:00"
  intent: Intent | null;
  heardFrom: string;
  /** ISO timestamp; its presence means onboarding is done. */
  completedAt: string;
};

/* ---- option catalogues (label + value), single source of truth for the UI ---- */

export const ROLES: { value: Role; label: string }[] = [
  { value: "founder", label: "Founder / Leadership" },
  { value: "engineering", label: "Engineering" },
  { value: "design", label: "Design" },
  { value: "sales", label: "Sales / Marketing" },
  { value: "people", label: "HR / People Ops" },
  { value: "support", label: "Support / BPO" },
  { value: "other", label: "Other" },
];

export const TEAM_SIZES: { value: TeamSize; label: string }[] = [
  { value: "1-10", label: "1–10" },
  { value: "11-50", label: "11–50" },
  { value: "51-200", label: "51–200" },
  { value: "200+", label: "200+" },
];

export const INTENTS: { value: Intent; label: string; hint: string }[] = [
  { value: "daily-office", label: "Daily remote office", hint: "A place the team hangs out and works from." },
  { value: "meetings", label: "Meetings & standups", hint: "Drop into rooms for syncs and huddles." },
  { value: "events", label: "Events & townhalls", hint: "Gather everyone for company-wide moments." },
  { value: "onboarding", label: "Onboarding new hires", hint: "Give newcomers a warm, guided space." },
  { value: "exploring", label: "Just exploring", hint: "Having a look around for now." },
];

export const HEARD_FROM: { value: string; label: string }[] = [
  { value: "twitter", label: "Twitter / X" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "friend", label: "A friend or colleague" },
  { value: "search", label: "Search engine" },
  { value: "other", label: "Somewhere else" },
];

/** Common timezones with IST first (the default — most of the team is in India,
 *  but shift teams span the globe, so keep it changeable). */
export const TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Kolkata", label: "India — IST (GMT+5:30)" },
  { value: "Asia/Dubai", label: "Dubai — GST (GMT+4)" },
  { value: "Europe/London", label: "London — GMT/BST" },
  { value: "Europe/Berlin", label: "Central Europe — CET" },
  { value: "America/New_York", label: "US East — ET" },
  { value: "America/Chicago", label: "US Central — CT" },
  { value: "America/Los_Angeles", label: "US Pacific — PT" },
  { value: "Asia/Singapore", label: "Singapore — SGT (GMT+8)" },
  { value: "Australia/Sydney", label: "Sydney — AEST" },
];

/** Avatar accents — the picker on the "who you are" step. */
export const AVATAR_SWATCHES: { key: string; gradient: string }[] = [
  { key: "coral", gradient: "linear-gradient(150deg, #ff8f7a 0%, #f8617f 100%)" },
  { key: "indigo", gradient: "linear-gradient(150deg, #6d8bff 0%, #2b3ee8 100%)" },
  { key: "emerald", gradient: "linear-gradient(150deg, #52e0a3 0%, #12a37a 100%)" },
  { key: "amber", gradient: "linear-gradient(150deg, #ffcf6b 0%, #f79426 100%)" },
  { key: "violet", gradient: "linear-gradient(150deg, #c08bff 0%, #7c3aed 100%)" },
  { key: "slate", gradient: "linear-gradient(150deg, #7c8698 0%, #3b4252 100%)" },
];

export function gradientForAvatar(key: string): string {
  return (AVATAR_SWATCHES.find((s) => s.key === key) ?? AVATAR_SWATCHES[0]).gradient;
}

/* ---- per-user persistence ---- */

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
]);

/** Guess a company name from a work email's domain (acme.com → "Acme"). Returns
 *  "" for free providers, where the domain tells us nothing about the company. */
export function deriveCompanyFromEmail(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return "";
  const base = domain.split(".")[0] ?? "";
  return base ? base[0].toUpperCase() + base.slice(1) : "";
}

function profileKey(email: string): string | null {
  return email ? `vw.profile:${email}` : null;
}

export function loadProfile(email: string): OnboardingProfile | null {
  const key = profileKey(email);
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as OnboardingProfile) : null;
  } catch {
    return null;
  }
}

export function saveProfile(email: string, profile: OnboardingProfile): void {
  const key = profileKey(email);
  if (!key || typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(profile));
  } catch {
    /* ignore unwritable storage */
  }
}

/** True once the account has finished onboarding. */
export function isOnboarded(email: string): boolean {
  return !!loadProfile(email)?.completedAt;
}
