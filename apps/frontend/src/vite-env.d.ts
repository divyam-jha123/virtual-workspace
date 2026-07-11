/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL for the LiveKit token endpoint (default http://localhost:3000). */
  readonly VITE_BACKEND_URL?: string;
}
