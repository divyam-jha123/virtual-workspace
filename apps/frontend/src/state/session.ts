/**
 * The signed-in user, as carried by the backend's JWT.
 *
 * This replaces the anonymous per-tab id the game used to invent (issue #27).
 * `userId` is the LiveKit participant identity the backend puts in the room
 * token, so positions we publish must be stamped with this same value.
 */

const TOKEN_KEY = "vw.token";

export interface Session {
  /** JWT `sub` — the user's id, and their LiveKit identity. */
  userId: string;
  email: string;
  /** The account's display name, shown on the avatar's name tag. */
  name: string;
  /** The raw JWT, sent as a Bearer token to the backend. */
  accessToken: string;
}

interface JwtClaims {
  sub: string;
  email: string;
  name: string;
  /** Expiry, in seconds since the epoch. */
  exp?: number;
}

/** Decode a JWT payload. Returns null if it isn't a readable token. */
function decodeClaims(token: string): JwtClaims | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    // JWTs use base64url; atob wants plain base64.
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as Partial<JwtClaims>;
    if (!claims.sub || !claims.email || !claims.name) return null;
    return claims as JwtClaims;
  } catch {
    return null;
  }
}

/**
 * The current session, or null if signed out. Note this trusts the token's
 * claims only to decide what to render — the backend re-verifies the signature
 * on every request, so a tampered token buys nothing but a broken UI.
 */
export function getSession(): Session | null {
  const accessToken = localStorage.getItem(TOKEN_KEY);
  if (!accessToken) return null;

  const claims = decodeClaims(accessToken);
  if (!claims) {
    clearSession();
    return null;
  }
  // Expired tokens would 401 at the token endpoint; drop them here so the user
  // gets the login screen instead of a silent failure to join the room.
  if (claims.exp !== undefined && claims.exp * 1000 <= Date.now()) {
    clearSession();
    return null;
  }

  return {
    userId: claims.sub,
    email: claims.email,
    name: claims.name,
    accessToken,
  };
}

/** Persist a freshly issued token. Throws if it isn't a usable JWT. */
export function setSession(accessToken: string): Session {
  localStorage.setItem(TOKEN_KEY, accessToken);
  const session = getSession();
  if (!session) {
    throw new Error("backend returned a token we cannot read");
  }
  return session;
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
}
