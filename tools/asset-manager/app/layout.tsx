import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Asset Manager",
  description: "Art pipeline for the map MCP 2D map system",
};

const nav = [
  { href: "/", label: "Packs" },
  { href: "/assets", label: "Assets" },
  { href: "/import", label: "Import" },
  { href: "/licenses", label: "Licenses" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-line bg-surface">
            <div className="max-w-7xl mx-auto px-6 h-12 flex items-center gap-8">
              <Link href="/" className="font-semibold text-ink tracking-tight">
                Asset Manager
              </Link>
              <nav className="flex gap-1 text-sm">
                {nav.map((n) => (
                  <Link key={n.href} href={n.href} className="px-2.5 py-1 rounded text-muted hover:text-ink hover:bg-subtle">
                    {n.label}
                  </Link>
                ))}
              </nav>
              <span className="ml-auto text-xs text-muted">
                MCP contract <code className="font-mono text-ink">/v1</code> &middot; 16px grid
              </span>
            </div>
          </header>
          <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
