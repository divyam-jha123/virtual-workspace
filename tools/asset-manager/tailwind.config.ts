import type { Config } from "tailwindcss";

/**
 * Scoped to this tool only.
 *
 * A light, restrained palette for an internal tool: one accent, three greys, and
 * status colours that carry meaning rather than decoration. Tokens are named for
 * their role, so a page never hard-codes a shade.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f6f7f9", // page background
        surface: "#ffffff", // cards, tables, panels
        subtle: "#eef1f5", // table headers, inset fills
        line: "#d7dce3", // borders
        strong: "#b9c1cb", // emphasised borders
        ink: "#111820", // primary text
        muted: "#5b6672", // secondary text
        accent: "#1f6feb",
        warn: "#9a6700",
        danger: "#b42318",
        ok: "#14804a",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      borderRadius: {
        DEFAULT: "4px",
        md: "5px",
        lg: "6px",
      },
    },
  },
  plugins: [],
};

export default config;
