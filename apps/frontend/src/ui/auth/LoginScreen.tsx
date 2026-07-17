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
          Rejoin your workspace.
        </p>

        {/*
          Google renders its button into this node — see useGoogleSignIn. While
          that is in flight (or while we exchange the credential) we cover it
          with a matching placeholder so the layout never jumps.
        */}
        <div className="relative min-h-[44px]">
          <div
            ref={containerRef}
            className={loading || pending ? "invisible" : "flex justify-center"}
          />

          {(pending || loading) && (
            <div className="absolute inset-0 flex min-h-[44px] items-center justify-center gap-2.5 rounded-xl border border-vk-border bg-vk-surface text-[15px] font-medium text-vk-muted shadow-[0_1px_2px_rgba(22,35,43,0.06)]">
              <span
                aria-hidden="true"
                className="size-[18px] animate-vk-spin rounded-full border-[2.5px] border-vk-border border-t-vk-accent"
              />
              {loading ? "Signing you in…" : "Loading Google sign-in…"}
            </div>
          )}
        </div>

        <div role="separator" className="my-[22px] flex items-center gap-3 text-[13px] text-vk-subtle">
          <span className="h-px flex-1 bg-vk-rule" />
          or
          <span className="h-px flex-1 bg-vk-rule" />
        </div>

        <form onSubmit={submitEmail} noValidate className="flex flex-col gap-[18px]">
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

          <button
            type="submit"
            disabled={loading}
            className="mt-1 flex min-h-[50px] w-full items-center justify-center gap-2.5 rounded-xl bg-vk-accent text-base font-semibold text-white shadow-[0_4px_14px_rgba(33,69,230,0.3)] transition-colors outline-none hover:bg-vk-accent-hover focus-visible:ring-[3px] focus-visible:ring-vk-accent/40 disabled:cursor-not-allowed disabled:bg-vk-accent-weak disabled:shadow-none"
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
