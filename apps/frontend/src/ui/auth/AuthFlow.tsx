/**
 * Owns which auth step is on screen.
 *
 * Email sign-in is two steps — ask for a code, then enter it — and this keeps
 * both inside one React root. The alternative, routing the code step through
 * main.ts like the plain-DOM screens, would mean a second mount/unmount seam and
 * a `showVerifyCode(email)` that has to carry the address around. There's no URL
 * to route to anyway (see main.ts: navigation is function calls, no router).
 */

import { useState } from "react";
import type { Session } from "../../state/session";
import { LoginScreen } from "./LoginScreen";
import { VerifyCodeScreen } from "./VerifyCodeScreen";

export interface AuthFlowProps {
  onAuthed: (session: Session) => void;
}

type Step = { name: "email" } | { name: "code"; email: string };

export function AuthFlow({ onAuthed }: AuthFlowProps) {
  const [step, setStep] = useState<Step>({ name: "email" });

  if (step.name === "code") {
    return (
      <VerifyCodeScreen
        email={step.email}
        onAuthed={onAuthed}
        onBack={() => setStep({ name: "email" })}
      />
    );
  }

  return (
    <LoginScreen
      onAuthed={onAuthed}
      onCodeSent={(email) => setStep({ name: "code", email })}
    />
  );
}
