/**
 * The Vorkium login screen — a port of the "Vorkium Login & Signup" design,
 * narrowed to a single login page. There is no signup screen and no password
 * field: an account is created on first Google sign-in, and the display name
 * comes from the Google profile until the onboarding flow lands.
 *
 * Email sign-in is a one-time code sent to your inbox. The form is here and
 * validates, but the backend endpoint doesn't exist yet — submitting says so.
 * Google is the working path for now. See `submitEmail` below.
 */

import { useState, type FormEvent } from "react";
import { loginWithGoogle } from "../../net/authClient";
import { setSession, type Session } from "../../state/session";
import { useGoogleSignIn } from "./useGoogleSignIn";

export interface LoginScreenProps {
  onAuthed: (session: Session) => void;
}

/** Same shape the design's prototype validated against. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function emailError(email: string): string | null {
  if (!email.trim()) return "Email is required.";
  if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address.";
  return null;
}

export function LoginScreen({ onAuthed }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

  const { containerRef, loading, pending, error } = useGoogleSignIn(async (idToken) => {
    try {
      const accessToken = await loginWithGoogle(idToken);
      onAuthed(setSession(accessToken));
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[auth] google sign-in failed", e);
      // What the hook shows in the banner: the underlying reason is a backend
      // detail, and none of its variants are actionable by the user.
      throw new Error("We couldn't log you in. Please try again in a moment.");
    }
  });

  const invalid = emailError(email);
  const showEmailError = (touched || attempted) && invalid ? invalid : null;

  function submitEmail(e: FormEvent): void {
    e.preventDefault();
    setAttempted(true);
    if (emailError(email)) return;
    // Deliberate placeholder: emailing a one-time code needs a backend endpoint
    // and a mail provider, neither of which exists yet.
    setEmailNotice("Email sign-in isn't ready yet — please continue with Google for now.");
  }

  const banner = error ?? emailNotice;

  return (
    // `vk-auth` opts this tree into the scoped reset in styles.css — without it
    // the form controls inherit browser defaults (see the note there).
    <div className="vk-auth flex min-h-screen items-center justify-center bg-vk-page px-6 py-12 font-vk text-vk-ink">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img src="/vorkium-logo.png" alt="" className="h-14 w-auto" />
          {/* <span className="text-xl font-bold tracking-[-0.02em]">Vorkium</span> */}
        </div>

        {banner && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2.5 rounded-xl border border-vk-danger-border bg-vk-danger-bg px-3.5 py-3 text-sm/relaxed text-vk-danger-ink"
          >
            <span
              aria-hidden="true"
              className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-vk-danger text-xs font-bold text-white"
            >
              !
            </span>
            <span>{banner}</span>
          </div>
        )}

        {/* <h1 className="mb-2 text-center text-[28px] font-bold tracking-[-0.02em]">Welcome back</h1> */}
        <p className="mb-7 text-center text-[15px] text-vk-muted">
            Join your workspace to get started.
        </p>

        {/*
          The design's Google button, with Google's real one laid over it,
          invisible — see useGoogleSignIn for why the click has to land on
          theirs. The visual below is inert (aria-hidden + pointer-events-none):
          the overlay is the actual control, so it owns the click, the focus, and
          what a screen reader announces. `group-focus-within` is how the ring
          shows, since focus lands on the iframe we can't see.

          Both stay mounted while pending — GIS needs its container in the DOM to
          render into — and hide behind the placeholder so layout never jumps.
        */}
        <div className="group relative min-h-12">
          <div
            aria-hidden="true"
            className={`pointer-events-none flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-vk-border bg-vk-surface text-[15px] font-medium text-vk-ink shadow-[0_1px_2px_rgba(22,35,43,0.06)] transition-colors group-hover:bg-vk-surface-hover group-focus-within:shadow-[0_0_0_3px_rgba(33,69,230,0.35)] ${
              loading || pending ? "invisible" : ""
            }`}
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
              />
              <path
                fill="#FBBC05"
                d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
              />
            </svg>
            Continue with Google
          </div>

          <div
            ref={containerRef}
            className={`vk-google-overlay ${loading || pending ? "invisible" : ""}`}
          />

          {(pending || loading) && (
            <div className="absolute inset-0 flex min-h-12 items-center justify-center gap-2.5 rounded-xl border border-vk-border bg-vk-surface text-[15px] font-medium text-vk-muted shadow-[0_1px_2px_rgba(22,35,43,0.06)]">
              <span
                aria-hidden="true"
                className="size-[18px] animate-vk-spin rounded-full border-[2.5px] border-vk-border border-t-vk-accent"
              />
              {loading ? "Signing you in…" : "Loading Google sign-in…"}
            </div>
          )}
        </div>

        <form onSubmit={submitEmail} noValidate className="flex flex-col gap-[18px] mt-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="vk-login-email" className="text-sm font-semibold">
              Email
            </label>
            <input
              id="vk-login-email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailNotice(null);
              }}
              onBlur={() => setTouched(true)}
              aria-invalid={!!showEmailError}
              aria-describedby={showEmailError ? "vk-login-email-error" : undefined}
              className={`min-h-12 rounded-xl border bg-vk-surface px-3.5 text-[15px] text-vk-ink outline-none focus:border-vk-accent focus:ring-[3px] focus:ring-vk-accent/18 ${
                showEmailError ? "border-vk-danger" : "border-vk-border"
              }`}
            />
            {showEmailError && (
              <span id="vk-login-email-error" role="alert" className="text-[13px] text-vk-danger-text">
                {showEmailError}
              </span>
            )}
          </div>

          {/*
            Fades to vk-accent-weak until the email parses, matching the design,
            which disables on `!valid || anyLoading`. `loading` is the Google
            exchange — the design greys this out during that too, so the page
            never offers two live sign-in paths at once.
          */}
          <button
            type="submit"
            disabled={loading || !!invalid}
            className="cursor-pointer mt-1 flex min-h-[50px] w-full items-center justify-center gap-2.5 rounded-xl bg-vk-accent text-base font-semibold text-white shadow-[0_4px_14px_rgba(33,69,230,0.3)] transition-colors outline-none hover:bg-vk-accent-hover focus-visible:ring-[3px] focus-visible:ring-vk-accent/40 disabled:cursor-not-allowed disabled:bg-vk-accent-weak disabled:shadow-none"
          >
            Continue with email
          </button>
        </form>

        <p className="mt-6 text-center text-[12.5px]/relaxed text-vk-subtle">
          By continuing, you agree to Vorkium's{" "}
          <a href="#" className="text-vk-muted underline">
            Terms
          </a>{" "}
          and{" "}
          <a href="#" className="text-vk-muted underline">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
