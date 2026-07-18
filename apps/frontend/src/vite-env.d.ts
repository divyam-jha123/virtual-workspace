/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL for the LiveKit token endpoint (default http://localhost:3000). */
  readonly VITE_BACKEND_URL?: string;
  /**
   * Google OAuth web client id, for the sign-in popup. Must be the same id the
   * backend verifies ID tokens against (its GOOGLE_CLIENT_ID). Public by design
   * — the ID-token flow has no client secret.
   */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
