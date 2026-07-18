/**
 * The seam between the two UI idioms. The auth screens are React; the map select,
 * character select, and HUD are still plain DOM rendered into the same #app node
 * (see main.ts). This exposes the React screens through the same shape as the
 * `render*` functions, and hands back an unmount so the caller can hand the node
 * back to the DOM screens without React and manual innerHTML fighting over it.
 *
 * The whole auth flow — login and the one-time code step — lives under the single
 * root mounted here; AuthFlow decides which is on screen.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "../../state/session";
import { AuthFlow } from "./AuthFlow";

/** Render the auth flow into `root`. Returns a function that unmounts it. */
export function mountLogin(
  root: HTMLElement,
  onAuthed: (session: Session) => void,
): () => void {
  root.innerHTML = "";
  root.className = "";

  const reactRoot = createRoot(root);
  reactRoot.render(
    <StrictMode>
      <AuthFlow onAuthed={onAuthed} />
    </StrictMode>,
  );

  return () => reactRoot.unmount();
}
