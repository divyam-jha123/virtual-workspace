import { AuthProvider } from "@/components/AuthProvider";
import { OfficesProvider } from "@/components/OfficesProvider";
import { OnboardingGate } from "@/components/OnboardingGate";
import { SiteHeader } from "@/components/SiteHeader";
import { Lobby } from "@/components/Lobby";
import { CreateOfficeModal } from "@/components/CreateOfficeModal";
import { JoinOfficeModal } from "@/components/JoinOfficeModal";
import { MapChooserModal } from "@/components/MapChooserModal";
import styles from "./page.module.css";

export default function LobbyPage() {
  return (
    <AuthProvider>
      {/* New accounts finish the onboarding questionnaire before reaching the lobby. */}
      <OnboardingGate>
        <OfficesProvider>
          <div className={styles.page}>
            <SiteHeader />
            <main className={styles.content}>
              <Lobby />
            </main>

            <CreateOfficeModal />
            <JoinOfficeModal />
            <MapChooserModal />
          </div>
        </OfficesProvider>
      </OnboardingGate>
    </AuthProvider>
  );
}
