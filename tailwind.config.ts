import type { Config } from "tailwindcss";

/**
 * "Proof" theme — duotone proofreader's desk: warm paper + ink, a vibrant
 * leaf-green working accent, and red reserved exclusively for flagged risk.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "#FAF7F0",
          deep: "#F1EDE2",
        },
        line: "#E7E2D4",
        ink: {
          DEFAULT: "#232230",
          soft: "#6E6C7E",
          faint: "#9B99A6",
        },
        leaf: {
          DEFAULT: "#0FAE6B",
          deep: "#0B8A54",
          wash: "#E2F5EA",
          ring: "#7FD9B0",
        },
        flag: {
          DEFAULT: "#E04E33",
          wash: "#FBEAE4",
        },
        /** Editor's ink — user-made edits on the Primary document. */
        pen: {
          DEFAULT: "#7048C6",
          wash: "#F0EAFB",
        },
        /** Marginal notes — commented ranges. */
        note: {
          DEFAULT: "#C8821A",
          wash: "#FBF3E2",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "-apple-system", "sans-serif"],
        mono: ["var(--font-space-mono)", "Space Mono", "monospace"],
        serif: ["var(--font-lora)", "Lora", "Georgia", "serif"],
        display: ["var(--font-playfair)", "Playfair Display", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
