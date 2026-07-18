/**
 * Sign-in calls to our backend, mirroring the contracts in apps/backend
 * AuthController. Two ways in, both ending at the same `{ accessToken }` — our
 * JWT, which is what everything else (the LiveKit token endpoint) authenticates
 * with:
 *
 * - Google: hand over the ID token from the popup; the backend verifies it
 *   against Google's keys.
 * - Email: ask for a one-time code, then trade the code for the token.
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000";

interface LoginResponse {
  accessToken: string;
}

/** Exchange a Google ID token for our access token. Throws on a non-2xx reply. */
export async function loginWithGoogle(idToken: string): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/auth/google`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });

  if (!res.ok) {
    // 401 means Google vouched for a token the backend wouldn't accept (wrong
    // client id, or an unverified email) — nothing the user can fix by retrying.
    const detail = res.status === 401 ? "Google sign-in was rejected" : `HTTP ${res.status}`;
    throw new Error(`login failed: ${detail}`);
  }

  const { accessToken } = (await res.json()) as LoginResponse;
  return accessToken;
}

/**
 * Ask the backend to email a one-time login code.
 *
 * Resolves the same way whether or not the address has an account — the backend
 * won't say, and with passwordless sign-in it doesn't matter.
 */
export async function requestEmailCode(email: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/auth/email/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!res.ok) {
    // 429 is the send-rate limit, and its message names the wait — worth
    // showing verbatim, unlike the rest.
    throw new Error(
      res.status === 429
        ? await backendMessage(res, "Too many codes requested. Try again later.")
        : "We couldn't send your code. Please try again in a moment.",
    );
  }
}

/** Trade a one-time code for our access token. Throws on a non-2xx reply. */
export async function verifyEmailCode(email: string, code: string): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/auth/email/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });

  if (!res.ok) {
    // 401 covers wrong, expired, already-used, and out-of-attempts alike — the
    // backend won't distinguish them, so neither can we.
    throw new Error(
      res.status === 401
        ? "That code is incorrect or has expired. Check the code, or send a new one."
        : "We couldn't sign you in. Please try again in a moment.",
    );
  }

  const { accessToken } = (await res.json()) as LoginResponse;
  return accessToken;
}

/** Nest's error body is `{ message }`; fall back if it's shaped otherwise. */
async function backendMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" ? body.message : fallback;
  } catch {
    return fallback;
  }
}
