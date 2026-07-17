/**
 * The seam between the two UI idioms. The login screen is React; the map select,
 * character select, and HUD are still plain DOM rendered into the same #app node
 * (see main.ts). This exposes the React screen through the same shape as the
 * `render*` functions, and hands back an unmount so the caller can hand the node
 * back to the DOM screens without React and manual innerHTML fighting over it.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "../../state/session";
import { LoginScreen } from "./LoginScreen";

/** Render the login screen into `root`. Returns a function that unmounts it. */
export function mountLogin(
  root: HTMLElement,
  onAuthed: (session: Session) => void,
): () => void {
  root.innerHTML = "";
  root.className = "";

  const reactRoot = createRoot(root);
  reactRoot.render(
    <StrictMode>
      <LoginScreen onAuthed={onAuthed} />
    </StrictMode>,
  );

  return () => reactRoot.unmount();
}
