/**
 * Sign-in calls to our backend. Mirrors the `POST /auth/google` contract in
 * apps/backend AuthController: we hand over the ID token from Google's popup,
 * the backend verifies it against Google's keys and returns *our* JWT — which
 * is what everything else (the LiveKit token endpoint) authenticates with.
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
