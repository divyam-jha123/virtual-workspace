/**
 * Wraps Google Identity Services so the login screen never touches the global.
 * GIS loads from the <script> tag in index.html and hands back an ID token,
 * which the backend verifies (see net/authClient).
 *
 * Google renders the button itself, into the node you attach `containerRef` to,
 * and it can't be styled: it lives in a cross-origin iframe, and `renderButton`
 * only takes the options in GoogleButtonOptions below. None of them reach the
 * design's 12px radius, Outfit face, or 48px height.
 *
 * It still has to be Google's button that takes the click — the ID-token flow
 * only issues a credential from it. (A freely styled button would mean the OAuth
 * auth-code flow, which needs a client secret and a server-side exchange.) So
 * LoginScreen paints the design's button and lays this one over it, invisible;
 * see `.vk-google-overlay` in styles.css. The options below are near-irrelevant
 * as a result — nobody sees this button. Only `width` still matters, since it
 * sets the widget's own box before the CSS stretches it to fill.
 *
 * The seam to watch: this leans on GIS keeping a plain iframe we can size from
 * the outside. If Google changes that, the button goes invisible rather than
 * ugly — so if sign-in ever appears to do nothing on click, look here first.
 */

import { useEffect, useRef, useState } from "react";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

/** The slice of the GIS API we use. */
interface GoogleIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    auto_select?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: GoogleButtonOptions): void;
  cancel(): void;
}

interface GoogleButtonOptions {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "small" | "medium" | "large";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

/** Resolve once the deferred GIS script has attached `window.google`. */
function whenGoogleReady(): Promise<GoogleIdApi> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const api = window.google?.accounts.id;
      if (api) return resolve(api);
      if (Date.now() - started > 10_000) {
        return reject(new Error("Google sign-in didn't load. Check your connection and refresh."));
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

export interface GoogleSignIn {
  /** Attach to the element Google should render its button into. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** True while the credential is being exchanged with our backend. */
  loading: boolean;
  /** True until Google's button has actually rendered. */
  pending: boolean;
  /** User-facing failure text, or null. */
  error: string | null;
}

/**
 * @param onCredential called with the Google ID token once the user picks an
 *   account. Kept in a ref, so it need not be referentially stable. Throw from
 *   it to show a message in the banner — the thrown text is what the user sees.
 */
export function useGoogleSignIn(
  onCredential: (idToken: string) => void | Promise<void>,
): GoogleSignIn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  useEffect(() => {
    if (!CLIENT_ID) {
      setPending(false);
      setError("Google sign-in isn't configured. Set VITE_GOOGLE_CLIENT_ID and restart.");
      return;
    }

    let cancelled = false;

    void whenGoogleReady()
      .then((api) => {
        if (cancelled || !containerRef.current) return;

        api.initialize({
          client_id: CLIENT_ID,
          auto_select: false,
          callback: (response) => {
            if (!response.credential) {
              setError("Google sign-in was cancelled or failed. Please try again.");
              return;
            }
            setError(null);
            setLoading(true);
            void Promise.resolve(callbackRef.current(response.credential))
              .catch((e: unknown) => {
                setError(e instanceof Error ? e.message : String(e));
                // Only stop the spinner on failure — on success the screen is
                // unmounting, and clearing it would flash the button again.
                setLoading(false);
              });
          },
        });

        api.renderButton(containerRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          // The 400px column the design centres on. Rendering at full width
          // keeps the stretch to fill roughly 1:1 horizontally.
          width: 400,
        });
        setPending(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPending(false);
        setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      window.google?.accounts.id.cancel();
      // Google appends its iframe rather than replacing what's there, so a
      // re-run (StrictMode double-invokes effects in dev) would stack a second
      // button on top of the first.
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, []);

  return { containerRef, loading, pending, error };
}
