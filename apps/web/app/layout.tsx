import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Poppins } from "next/font/google";
import "./globals.css";

/** Vorkium's wordmark + headings are a rounded geometric sans — Poppins matches. */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vorkium — Lobby",
  description: "Your team's virtual office. Spin up a spatial workspace and drop in.",
};

/** Runs before paint: applies the saved theme (or the OS preference) to <html>
 *  so there's no light-mode flash before React hydrates. */
const themeScript = `(function(){try{var t=localStorage.getItem('vw-theme')||((window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={poppins.variable} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
