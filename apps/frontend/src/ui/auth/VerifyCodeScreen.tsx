/**
 * Step two of email sign-in: enter the one-time code we just emailed.
 *
 * The code is one input, not six boxes. Six boxes look the part but break paste
 * and `autocomplete="one-time-code"` autofill unless each is wired up by hand —
 * and autofill is the fastest way through this screen when it works.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { requestEmailCode, verifyEmailCode } from "../../net/authClient";
import { setSession, type Session } from "../../state/session";

export interface VerifyCodeScreenProps {
  email: string;
  onAuthed: (session: Session) => void;
  onBack: () => void;
}

const CODE_LENGTH = 6;
/** Matches the backend's send-rate limit closely enough to keep users under it. */
const RESEND_COOLDOWN_SECONDS = 30;

export function VerifyCodeScreen({ email, onAuthed, onBack }: VerifyCodeScreenProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputRef = useRef<HTMLInputElement>(null);

  // The user arrived here to type a code and nothing else — don't make them
  // click first.
  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const complete = code.length === CODE_LENGTH;

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!complete || verifying) return;

    setVerifying(true);
    setError(null);
    setNotice(null);
    try {
      const accessToken = await verifyEmailCode(email, code);
      // Same chain as the Google path: store the token, hand the session up.
      onAuthed(setSession(accessToken));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "That code didn't work.");
      // A rejected code is dead either way, so clear it rather than leave the
      // user editing six digits that can no longer succeed.
      setCode("");
      setVerifying(false);
      inputRef.current?.focus();
    }
  }

  async function resend(): Promise<void> {
    setError(null);
    setNotice(null);
    setCode("");
    try {
      await requestEmailCode(email);
      setNotice(`We sent a new code to ${email}.`);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      inputRef.current?.focus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "We couldn't send another code.");
    }
  }

  return (
    // `vk-auth` opts this tree into the scoped reset in styles/tailwind.css — without it
    // the form controls inherit browser defaults (see the note there).
    <div className="vk-auth flex min-h-screen items-center justify-center bg-vk-page px-6 py-12 font-vk text-vk-ink">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img src="/vorkium-logo.png" alt="" className="h-14 w-auto" />
        </div>

        {error && (
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
            <span>{error}</span>
          </div>
        )}

        <h1 className="mb-2 text-center text-[22px] font-bold tracking-[-0.02em]">
          Check your email
        </h1>
        <p className="mb-7 text-center text-[15px] text-vk-muted">
          We sent a {CODE_LENGTH}-digit code to <span className="font-semibold text-vk-ink">{email}</span>.
        </p>

        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-[18px]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="vk-login-code" className="text-sm font-semibold">
              Login code
            </label>
            <input
              id="vk-login-code"
              ref={inputRef}
              // `one-time-code` is what gets the browser to offer the code from
              // the email; `numeric` gets a digit keypad on mobile.
              autoComplete="one-time-code"
              inputMode="numeric"
              placeholder="123456"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(e) => {
                // Strip anything non-digit so a pasted "Code: 123 456" still
                // lands as 123456 rather than silently failing the length check.
                setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH));
                setError(null);
              }}
              disabled={verifying}
              aria-invalid={!!error}
              className={`min-h-12 rounded-xl border bg-vk-surface px-3.5 text-center text-[22px] font-semibold tracking-[0.4em] text-vk-ink outline-none focus:border-vk-accent focus:ring-[3px] focus:ring-vk-accent/18 ${
                error ? "border-vk-danger" : "border-vk-border"
              }`}
            />
            {notice && <span className="text-[13px] text-vk-muted">{notice}</span>}
          </div>

          <button
            type="submit"
            disabled={!complete || verifying}
            className="cursor-pointer mt-1 flex min-h-[50px] w-full items-center justify-center gap-2.5 rounded-xl bg-vk-accent text-base font-semibold text-white shadow-[0_4px_14px_rgba(33,69,230,0.3)] transition-colors outline-none hover:bg-vk-accent-hover focus-visible:ring-[3px] focus-visible:ring-vk-accent/40 disabled:cursor-not-allowed disabled:bg-vk-accent-weak disabled:shadow-none"
          >
            {verifying && (
              <span
                aria-hidden="true"
                className="size-[18px] animate-vk-spin rounded-full border-[2.5px] border-white/40 border-t-white"
              />
            )}
            {verifying ? "Signing you in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-[13px] text-vk-muted">
          Didn't get it?{" "}
          <button
            type="button"
            onClick={() => void resend()}
            disabled={cooldown > 0 || verifying}
            className="cursor-pointer text-vk-accent underline underline-offset-2 outline-none hover:text-vk-accent-hover focus-visible:ring-[3px] focus-visible:ring-vk-accent/40 disabled:cursor-not-allowed disabled:text-vk-subtle disabled:no-underline"
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
        </p>

        <p className="mt-2 text-center text-[13px]">
          <button
            type="button"
            onClick={onBack}
            disabled={verifying}
            className="cursor-pointer text-vk-muted underline underline-offset-2 outline-none hover:text-vk-ink focus-visible:ring-[3px] focus-visible:ring-vk-accent/40 disabled:cursor-not-allowed"
          >
            Use a different email
          </button>
        </p>
      </div>
    </div>
  );
}
