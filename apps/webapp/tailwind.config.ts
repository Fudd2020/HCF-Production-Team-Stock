import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

export default {
  content: [
    "./app/**/*.{ts,tsx,jsx,js}",
    "./node_modules/@tremor/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      /**
       * Focus-ring defaults.
       *
       * why: these MUST live here, not as `--tw-ring-color` on `:root` in
       * `global.css`. Tailwind's preflight emits
       * `*, ::before, ::after { --tw-ring-color: rgb(59 130 246 / 0.5) }` —
       * a declaration applied directly to every element, which always beats a
       * value merely INHERITED from `:root`. Setting the variable on `:root`
       * is therefore inert, and every control whose only focus style is a bare
       * `focus-visible:ring-2` paints Tailwind's default blue (1.83:1 against
       * the warm canvas) instead of the brand colour.
       *
       * Declaring them here makes Tailwind emit the values into its own base
       * layer, so they actually apply. Verified in-browser: before this, a
       * keyboard-focused primary button showed `rgba(59,130,246,0.5)`.
       */
      ringColor: {
        DEFAULT: "#D93C2A", // 4.41:1 against the warm canvas
      },
      ringOffsetColor: {
        DEFAULT: "#FFFBF8", // the warm off-white canvas
      },
      /**
       * why: Tailwind's `ringOpacity.DEFAULT` is `0.5`, and it is applied to
       * `ringColor.DEFAULT`. Left alone, the coral renders as
       * `rgb(217 60 42 / 0.5)`, which composites over the warm canvas to
       * #EC9C91 — **2.10:1**, still short of the 3:1 that WCAG 2.1 SC 1.4.11
       * requires of a focus indicator. Solid it is 4.41:1.
       *
       * Measured in-browser, not inferred: at 0.5 the computed box-shadow was
       * `rgba(217, 60, 42, 0.5)`.
       */
      ringOpacity: {
        DEFAULT: "1",
      },
      fontSize: {
        "text-xs": [
          "0.75rem",
          {
            lineHeight: "1.125rem",
          },
        ],
        "text-sm": [
          "0.875rem",
          {
            lineHeight: "1.25rem",
          },
        ],
        "text-md": [
          "1rem",
          {
            lineHeight: "1.5rem",
          },
        ],
        "text-lg": [
          "1.125rem",
          {
            lineHeight: "1.75rem",
          },
        ],
        "text-xl": [
          "1.125rem",
          {
            lineHeight: "1.75rem",
          },
        ],

        "display-xs": [
          "1.5rem",
          {
            lineHeight: "2rem",
          },
        ],
        "display-sm": [
          "1.875rem",
          {
            lineHeight: "2.375rem",
          },
        ],
        "display-md": [
          "2.25rem",
          {
            lineHeight: "2.75rem",
            letterSpacing: "-2%",
          },
        ],
        "display-lg": [
          "3rem",
          {
            lineHeight: "3.75rem",
            letterSpacing: "-2%",
          },
        ],
        "display-xl": [
          "3.75rem",
          {
            lineHeight: "4.5rem",
            letterSpacing: "-2%",
          },
        ],
        "display-2xl": [
          "4.5rem",
          {
            lineHeight: "5.625rem",
            letterSpacing: "-2%",
          },
        ],
        "tremor-label": ["0.75rem", { lineHeight: "1 rem" }],
        "tremor-default": ["0.875rem", { lineHeight: "1.25rem" }],
        "tremor-title": ["1.125rem", { lineHeight: "1.75rem" }],
        "tremor-metric": ["1.875rem", { lineHeight: "2.25rem" }],
      },
      fontFamily: {
        inter: ["Inter", "sans-serif"],
      },
      colors: {
        white: "#ffffff",
        black: "#000000",
        muted: colors.gray[200],
        gray: {
          25: "#FCFCFD",
          50: "#F9FAFB",
          100: "#F2F4F7",
          200: "#EAECF0",
          300: "#D0D5DD",
          400: "#98A2B3",
          500: "#667085",
          600: "#475467",
          700: "#344054",
          800: "#1D2939",
          900: "#101828",
        },
        /**
         * HCF brand coral.
         *
         * `500` (#FF4631, the brand accent) and `600` (#D93C2A) are PINNED —
         * they are Neil's decisions, not generated values. The rule that
         * separates them: **`600` is the only one that may sit under white
         * text** (4.55:1); `500` is 3.40:1 under white and is therefore
         * restricted to fills, icons, borders and large type.
         *
         * The old Shelf ramp set DEFAULT/500/600/700 all to the same hex,
         * which made every hover and active state a silent no-op. This ramp
         * genuinely darkens — do not flatten it again.
         */
        primary: {
          DEFAULT: "#FF4631",
          25: "#FFF6F5",
          50: "#FFEDEB",
          100: "#FFDAD6",
          200: "#FFBAB3",
          300: "#FF9185",
          // why: tint only. `400` must never be a button hover state — a hover
          // that LIGHTENS under white text is the defect this ramp replaces.
          400: "#FF6857",
          500: "#FF4631",
          600: "#D93C2A",
          700: "#B22E1F",
          800: "#8B2418",
          900: "#641A12",
        },
        /**
         * Warm off-white page background, rgb(255, 251, 248).
         * Applied to `body` in `app/styles/global.css`. White cards sit on it
         * at 1.03:1, so their `border-gray-200` + `shadow` are what make them
         * read as raised — do not remove either.
         */
        canvas: "#FFFBF8",
        error: {
          25: "#FFFBFA",
          50: "#FEF3F2",
          100: "#FEE4E2",
          200: "#FECDCA",
          300: "#FDA29B",
          400: "#F97066",
          500: "#F04438",
          600: "#D92D20",
          700: "#B42318",
          800: "#912018",
          900: "#7A271A",
        },
        warning: {
          25: "#FFFCF5",
          50: "#FFFAEB",
          100: "#FEF0C7",
          200: "#FEDF89",
          300: "#FEC84B",
          400: "#FDB022",
          500: "#F79009",
          600: "#DC6803",
          700: "#B54708",
          800: "#93370D",
          900: "#7A2E0E",
        },
        success: {
          25: "#F6FEF9",
          50: "#ECFDF3",
          100: "#D1FADF",
          200: "#A6F4C5",
          300: "#6CE9A6",
          400: "#32D583",
          500: "#12B76A",
          600: "#039855",
          700: "#027A48",
          800: "#05603A",
          900: "#054F31",
        },
        ring: {
          DEFAULT: "#EAF2FF",
        },
        tremor: {
          brand: {
            faint: "#eff6ff", // blue-50
            muted: "#bfdbfe", // blue-200
            subtle: "#60a5fa", // blue-400
            DEFAULT: "#3b82f6", // blue-500
            emphasis: "#1d4ed8", // blue-700
            inverted: "#ffffff", // white
          },
          background: {
            muted: "#f9fafb", // gray-50
            subtle: "#f3f4f6", // gray-100
            DEFAULT: "#ffffff", // white
            emphasis: "#374151", // gray-700
          },
          border: {
            DEFAULT: "#e5e7eb", // gray-200
          },
          ring: {
            DEFAULT: "#e5e7eb", // gray-200
          },
          content: {
            subtle: "#9ca3af", // gray-400
            DEFAULT: "#6b7280", // gray-500
            emphasis: "#374151", // gray-700
            strong: "#111827", // gray-900
            inverted: "#ffffff", // white
          },
        },
        // dark mode
        "dark-tremor": {
          brand: {
            faint: "#0B1229", // custom
            muted: "#172554", // blue-950
            subtle: "#1e40af", // blue-800
            DEFAULT: "#3b82f6", // blue-500
            emphasis: "#60a5fa", // blue-400
            inverted: "#030712", // gray-950
          },
          background: {
            muted: "#131A2B", // custom
            subtle: "#1f2937", // gray-800
            DEFAULT: "#111827", // gray-900
            emphasis: "#d1d5db", // gray-300
          },
          border: {
            DEFAULT: "#1f2937", // gray-800
          },
          ring: {
            DEFAULT: "#1f2937", // gray-800
          },
          content: {
            subtle: "#4b5563", // gray-600
            DEFAULT: "#6b7280", // gray-500
            emphasis: "#e5e7eb", // gray-200
            strong: "#f9fafb", // gray-50
            inverted: "#000000", // black
          },
        },
        sidebar: {
          DEFAULT: "var(--sidebar-background)",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
        },
      },

      boxShadow: {
        DEFAULT: "0px 1px 2px rgba(16, 24, 40, 0.05)",
        sm: "0px 1px 3px rgba(16, 24, 40, 0.1), 0px 1px 2px rgba(16, 24, 40, 0.06)",
        md: "0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)",
        lg: "0px 12px 16px -4px rgba(16, 24, 40, 0.08), 0px 4px 6px -2px rgba(16, 24, 40, 0.03)",
        xl: "0px 20px 24px -4px rgba(16, 24, 40, 0.08), 0px 8px 8px -4px rgba(16, 24, 40, 0.03)",
        "2xl": "0px 24px 48px -12px rgba(16, 24, 40, 0.18)",
        "3xl": "0px 32px 64px -12px rgba(16, 24, 40, 0.14)",
        "tremor-input": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "tremor-card":
          "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
        "tremor-dropdown":
          "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
        "dark-tremor-input": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "dark-tremor-card":
          "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
        "dark-tremor-dropdown":
          "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
        "camera-overlay": "0px 0px 0px 2000px rgb(0 0 0 / 0.6)",
      },
      borderRadius: {
        "tremor-small": "0.375rem",
        "tremor-default": "0.5rem",
        "tremor-full": "9999px",
      },

      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        hide: {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        slideIn: {
          from: {
            transform: "translateX(calc(100% + var(--viewport-padding)))",
          },
          to: { transform: "translateX(0))" },
        },
        swipeOut: {
          from: { transform: "translateX(var(--radix-toast-swipe-end-x))" },
          to: { transform: "translateX(calc(100% + var(--viewport-padding)))" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
    },
    container: {
      center: true,
      padding: "2rem",
    },
    animation: {
      "accordion-down": "accordion-down 0.2s ease-out",
      "accordion-up": "accordion-up 0.2s ease-out",
      hide: "hide 100ms ease-in",
      slideIn: "slideIn 150ms cubic-bezier(0.16, 1, 0.3, 1)",
      swipeOut: "swipeOut 100ms ease-out",
      pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      "caret-blink": "caret-blink 1.25s ease-out infinite",
    },
    aspectRatio: {
      auto: "auto",
      square: "1 / 1",
      video: "16 / 9",
      1: "1",
      2: "2",
      3: "3",
      4: "4",
      5: "5",
      6: "6",
      7: "7",
      8: "8",
      9: "9",
      10: "10",
      11: "11",
      12: "12",
      13: "13",
      14: "14",
      15: "15",
      16: "16",
    },
  },
  safelist: [
    {
      pattern:
        /^(bg-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ["hover", "ui-selected"],
    },
    {
      pattern:
        /^(text-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ["hover", "ui-selected"],
    },
    {
      pattern:
        /^(border-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ["hover", "ui-selected"],
    },
    {
      pattern:
        /^(ring-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
    {
      pattern:
        /^(stroke-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
    {
      pattern:
        /^(fill-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
  ],
  plugins: [
    require("@tailwindcss/typography"),
    require("@tailwindcss/forms"),
    require("@tailwindcss/aspect-ratio"),
    require("tailwind-scrollbar"),
    require("tailwindcss-animate"),
  ],
} satisfies Config;
