import { AuthProvider } from "@/components/AuthProvider";
import { OnboardingWizard } from "@/components/OnboardingWizard";

/** The post-login questionnaire. Reachable after Divyam's login (which hands off
 *  ?name&email); the dashboard redirects new accounts here before letting them in. */
export default function OnboardingPage() {
  return (
    <AuthProvider>
      <OnboardingWizard />
    </AuthProvider>
  );
}
