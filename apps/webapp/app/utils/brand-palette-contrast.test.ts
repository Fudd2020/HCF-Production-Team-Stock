/**
 * HCF brand palette contrast guarantees (US-003 AC8).
 *
 * These assertions pin the palette decisions that a future contributor is most
 * likely to undo by accident. They are asserted against the ALREADY-MEASURED
 * numbers recorded in the feature's design; the point is not to re-derive them
 * but to fail loudly if a token moves.
 *
 * The single most important thing this file records: **`primary-500`
 * (`#FF4631`) deliberately does NOT meet 4.5:1.** It is a brand accent for
 * fills, icons, borders and large display type — it is not a text colour, and
 * it must not be "fixed" by being used for body copy. That is what
 * `primary-700` and `gray-900` are for.
 *
 * Kept in its own file rather than appended to `color-contrast.test.ts`, which
 * tests the generic colour utility (and whose Shelf-orange values are test
 * data, not brand tokens).
 *
 * @see {@link file://./color-contrast.ts}
 * @see {@link file://../../tailwind.config.ts} — the `primary` scale and `canvas`
 */
import { getContrastRatio, meetsWCAG_AA } from "./color-contrast";

/** The palette, mirrored from `tailwind.config.ts`. */
const PALETTE = {
  /** Warm off-white page background — `body` / `bg-canvas`. */
  canvas: "#FFFBF8",
  /** Dark neutral from the HCF brand — the auth cover panel. */
  brandDark: "#26282E",
  /** Tailwind `gray-900`, the colour body copy actually resolves to. */
  gray900: "#101828",
  /** `primary-300` — disabled button fill. */
  primary300: "#FF9185",
  /** `primary-500` / DEFAULT — the brand accent. */
  primary500: "#FF4631",
  /** `primary-600` — the only shade that may sit under white text. */
  primary600: "#D93C2A",
  /** `primary-700` — every coral TEXT use, and the primary button hover. */
  primary700: "#B22E1F",
  /** `primary-800` — the primary button active/pressed state. */
  primary800: "#8B2418",
  white: "#FFFFFF",
} as const;

/** WCAG 1.4.3 normal-text threshold. */
const AA_TEXT = 4.5;
/** WCAG 1.4.3 large-text and 1.4.11 non-text threshold. */
const LARGE_TEXT_AND_UI = 3;

describe("HCF brand palette contrast", () => {
  describe("the dark neutral is readable on the warm canvas", () => {
    it("#26282E on the canvas clears AA for normal text", () => {
      expect(
        getContrastRatio(PALETTE.brandDark, PALETTE.canvas)
      ).toBeGreaterThanOrEqual(AA_TEXT);
      expect(meetsWCAG_AA(PALETTE.brandDark, PALETTE.canvas)).toBe(true);
    });

    it("body copy (gray-900) is darker still, so AC4 holds app-wide", () => {
      expect(getContrastRatio(PALETTE.gray900, PALETTE.canvas)).toBeGreaterThan(
        getContrastRatio(PALETTE.brandDark, PALETTE.canvas)
      );
    });
  });

  describe("the coral accent is a UI colour, NOT a text colour", () => {
    it("clears the 3:1 large-text / UI-component threshold on the canvas", () => {
      expect(
        getContrastRatio(PALETTE.primary500, PALETTE.canvas)
      ).toBeGreaterThanOrEqual(LARGE_TEXT_AND_UI);
    });

    it("clears 3:1 under white — enough for a fill, not for a label", () => {
      expect(
        getContrastRatio(PALETTE.white, PALETTE.primary500)
      ).toBeGreaterThanOrEqual(LARGE_TEXT_AND_UI);
    });

    /**
     * This test asserts a FAILURE on purpose.
     *
     * `#FF4631` is 3.31:1 on the canvas and 3.40:1 under white — both below
     * WCAG AA for normal text. That is a known, accepted property of the brand
     * accent, and the whole palette is built around it: coral is restricted to
     * fills, icons, borders and type at 24px+.
     *
     * If this test ever starts failing, somebody has changed `primary-500`.
     * Do NOT "fix" it by using coral for body text — use `primary-700`
     * (6.18:1 on the canvas) for coral text, or `gray-900` for body copy.
     */
    it("does NOT meet AA for normal text — deliberately, and must not be 'fixed'", () => {
      expect(meetsWCAG_AA(PALETTE.primary500, PALETTE.canvas)).toBe(false);
      expect(meetsWCAG_AA(PALETTE.white, PALETTE.primary500)).toBe(false);
    });
  });

  describe("primary-600 is the shade that carries white text", () => {
    it("clears AA for white labels on a solid fill", () => {
      expect(
        getContrastRatio(PALETTE.white, PALETTE.primary600)
      ).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("works as a focus ring against the canvas (>=3:1, WCAG 1.4.11)", () => {
      expect(
        getContrastRatio(PALETTE.primary600, PALETTE.canvas)
      ).toBeGreaterThanOrEqual(LARGE_TEXT_AND_UI);
    });
  });

  describe("primary-700 is the coral TEXT token", () => {
    it("clears AA for normal text on the canvas", () => {
      expect(meetsWCAG_AA(PALETTE.primary700, PALETTE.canvas)).toBe(true);
    });
  });

  describe("the button ramp genuinely darkens (AC5)", () => {
    const restingContrast = getContrastRatio(PALETTE.white, PALETTE.primary600);
    const hoverContrast = getContrastRatio(PALETTE.white, PALETTE.primary700);
    const activeContrast = getContrastRatio(PALETTE.white, PALETTE.primary800);

    it("resting, hover and active are three distinct colours", () => {
      const shades = new Set([
        PALETTE.primary600,
        PALETTE.primary700,
        PALETTE.primary800,
      ]);
      expect(shades.size).toBe(3);
    });

    it("hover and active IMPROVE white-text contrast rather than reducing it", () => {
      expect(hoverContrast).toBeGreaterThan(restingContrast);
      expect(activeContrast).toBeGreaterThan(hoverContrast);
    });

    it("every non-disabled state clears AA under white text", () => {
      for (const ratio of [restingContrast, hoverContrast, activeContrast]) {
        expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
      }
    });

    /**
     * `primary-300` under white is ~2.2:1. WCAG 1.4.3 exempts inactive
     * controls, and the `disabled` attribute plus `cursor-not-allowed` carry
     * the state non-visually — so this is documented, not enforced.
     */
    it("documents that the disabled fill is below AA, which WCAG exempts", () => {
      expect(meetsWCAG_AA(PALETTE.white, PALETTE.primary300)).toBe(false);
    });
  });

  describe("the auth cover panel", () => {
    it("carries white text at AAA", () => {
      expect(
        getContrastRatio(PALETTE.white, PALETTE.brandDark)
      ).toBeGreaterThanOrEqual(7);
    });

    it("keeps the coral crown visible as a graphical object (>=3:1)", () => {
      expect(
        getContrastRatio(PALETTE.primary500, PALETTE.brandDark)
      ).toBeGreaterThanOrEqual(LARGE_TEXT_AND_UI);
    });
  });
});
