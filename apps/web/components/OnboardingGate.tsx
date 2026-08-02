"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { isOnboarded } from "@/lib/onboarding";

/** Keeps the dashboard behind onboarding: once the session resolves, a signed-in
 *  account that hasn't finished the questionnaire is sent to /onboarding. A direct
 *  visit with no session (no email) just sees the dashboard, as before.
 *
 *  Renders nothing until the check settles, so the dashboard never flashes before
 *  a redirect. */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (user.email && !isOnboarded(user.email)) {
      router.replace("/onboarding");
    } else {
      setCleared(true);
    }
  }, [ready, user.email, router]);

  if (!cleared) return null;
  return <>{children}</>;
}
