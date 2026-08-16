/**
 * Geometry and pagination for label stationery (US-001 AC2, AC4).
 *
 * ## What these tests are actually for
 *
 * Label layout is the rare case where the bug reaches the user as a **binned
 * sheet of stationery**, not a stack trace. The error is cumulative: a
 * fractional mistake in the row pitch is invisible on row 1 and ruinous by
 * row 7, and nothing on screen shows it. So the arithmetic is pinned here,
 * where a typo costs a red test rather than a sheet of labels.
 *
 * ⚠️ **These prove self-consistency, not correctness.** They prove the grid
 * fills an A4 page exactly. They cannot prove it matches the stationery in
 * Neil's printer — only a ruler can (`DECISIONS.md` #4).
 *
 * @see {@link file://./label-sheets.ts}
 */

import { describe, expect, it } from "vitest";

import type { LabelSheetSpec } from "./label-sheets";
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  DEFAULT_LABEL_SHEET_ID,
  LABEL_SHEETS,
  LABEL_SHEET_OPTIONS,
  MAX_OFFSET_MM,
  clampOffset,
  gridHeightMm,
  gridWidthMm,
  isLabelSheetId,
  labelsPerSheet,
  nextStartPosition,
  normaliseStartPosition,
  offsetLimitsMm,
  paginateLabels,
  positionToCell,
} from "./label-sheets";

const ALL_SPECS = Object.values(LABEL_SHEETS);

/** Millimetre tolerance. Stationery specs are published to 0.1 mm. */
const TOLERANCE_MM = 0.01;

describe("stationery geometry", () => {
  it.each(ALL_SPECS)(
    "$id fills the width of an A4 page exactly",
    (spec: LabelSheetSpec) => {
      /**
       * `2 × marginLeft` assumes the grid is horizontally centred, which is
       * true of all three formats. If a future format has asymmetric side
       * margins this assertion is the thing that must change — deliberately,
       * with the right-hand margin added to the spec.
       */
      const total = gridWidthMm(spec) + spec.marginLeftMm * 2;
      expect(total).toBeCloseTo(A4_WIDTH_MM, 2);
    }
  );

  it.each(ALL_SPECS)(
    "$id fills the height of an A4 page exactly",
    (spec: LabelSheetSpec) => {
      const total = gridHeightMm(spec) + spec.marginTopMm * 2;
      expect(total).toBeCloseTo(A4_HEIGHT_MM, 2);
    }
  );

  it.each(ALL_SPECS)(
    "$id leaves room in the bottom margin for the 100 mm calibration rule",
    (spec: LabelSheetSpec) => {
      /**
       * AC3's mitigation prints a measurable reference line below the last row.
       * It is skipped when the band is under 8 mm, which would silently remove
       * the only defence against a rescaled print — so assert the band exists.
       */
      const bottomBand = A4_HEIGHT_MM - spec.marginTopMm - gridHeightMm(spec);
      expect(bottomBand).toBeGreaterThanOrEqual(8);
    }
  );

  it.each(ALL_SPECS)(
    "$id keeps the QR inside the label, padding included",
    (spec: LabelSheetSpec) => {
      const innerHeight = spec.labelHeightMm - spec.paddingMm * 2;
      const innerWidth = spec.labelWidthMm - spec.paddingMm * 2;

      expect(spec.qrSizeMm).toBeLessThanOrEqual(innerHeight + TOLERANCE_MM);
      expect(spec.qrSizeMm).toBeLessThanOrEqual(innerWidth + TOLERANCE_MM);
    }
  );

  it("the 25 mm square carries no name — DECISIONS.md #5", () => {
    /**
     * Not a nicety. There is no room for a name at 25 mm, and the accepted
     * consequence is that four identical XLRs are told apart by scanning, not
     * by eye. Someone "improving consistency" by switching this on would
     * produce a label whose name squeezes the QR below a scannable size.
     */
    expect(LABEL_SHEETS["lp70-25s"].showsName).toBe(false);
    expect(LABEL_SHEETS["lp70-25s"].layout).toBe("stacked");
  });

  it("both oblong formats do carry a name", () => {
    expect(LABEL_SHEETS.l7160.showsName).toBe(true);
    expect(LABEL_SHEETS.l7163.showsName).toBe(true);
  });

  it("offers the documented labels-per-sheet counts", () => {
    // The counts Neil buys stationery against — DECISIONS.md #4.
    expect(labelsPerSheet(LABEL_SHEETS["lp70-25s"])).toBe(70);
    expect(labelsPerSheet(LABEL_SHEETS.l7160)).toBe(21);
    expect(labelsPerSheet(LABEL_SHEETS.l7163)).toBe(14);
  });

  it("opens on Neil's primary stationery", () => {
    expect(DEFAULT_LABEL_SHEET_ID).toBe("lp70-25s");
    expect(LABEL_SHEET_OPTIONS[0].id).toBe(DEFAULT_LABEL_SHEET_ID);
  });

  it("offers every spec in the picker — no format is unreachable", () => {
    expect(LABEL_SHEET_OPTIONS).toHaveLength(ALL_SPECS.length);
  });
});

describe("isLabelSheetId", () => {
  it("accepts the supported formats", () => {
    expect(isLabelSheetId("lp70-25s")).toBe(true);
    expect(isLabelSheetId("l7160")).toBe(true);
  });

  it("rejects anything else, including inherited Object keys", () => {
    expect(isLabelSheetId("a4")).toBe(false);
    // `in` would say true here; `hasOwnProperty` is why it does not.
    expect(isLabelSheetId("toString")).toBe(false);
    expect(isLabelSheetId("")).toBe(false);
  });
});

describe("paginateLabels", () => {
  const spec = LABEL_SHEETS.l7160; // 21 per sheet

  it("splits 60 items onto three sheets of 21 (AC4)", () => {
    const items = Array.from({ length: 60 }, (_, index) => index);

    const pages = paginateLabels(items, spec);

    expect(pages).toHaveLength(3);
    expect(pages[0]).toHaveLength(21);
    expect(pages[1]).toHaveLength(21);
    // The remainder — the last sheet is partly used, which is normal.
    expect(pages[2]).toHaveLength(18);
  });

  it("never puts more than one sheet's worth on a page", () => {
    const items = Array.from({ length: 200 }, (_, index) => index);

    const pages = paginateLabels(items, spec);

    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(labelsPerSheet(spec));
    }
  });

  it("preserves order across the page boundary", () => {
    const items = Array.from({ length: 25 }, (_, index) => index);

    const pages = paginateLabels(items, spec);

    // Item 21 is the first on sheet two, not a duplicate of the last on one.
    expect(pages[0][20]).toBe(20);
    expect(pages[1][0]).toBe(21);
    expect(pages.flat()).toEqual(items);
  });

  it("loses nothing at an exact sheet boundary", () => {
    const items = Array.from({ length: 42 }, (_, index) => index);

    const pages = paginateLabels(items, spec);

    // Exactly two full sheets — and crucially NOT a third, empty one, which
    // would print a blank page of stationery.
    expect(pages).toHaveLength(2);
    expect(pages.flat()).toHaveLength(42);
  });

  it("prints a single selected item as one page (edge case)", () => {
    const pages = paginateLabels(["only"], spec);

    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual(["only"]);
  });

  it("produces no pages at all for an empty selection", () => {
    // Not one empty page — that would send a blank sheet to the printer.
    expect(paginateLabels([], spec)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 *  US-002 — starting part-way down a part-used sheet                          *
 * -------------------------------------------------------------------------- */

describe("normaliseStartPosition (AC4)", () => {
  const spec = LABEL_SHEETS.l7160; // 21 per sheet

  it("accepts a real position", () => {
    expect(normaliseStartPosition(6, spec)).toBe(6);
    expect(normaliseStartPosition(1, spec)).toBe(1);
    expect(normaliseStartPosition(21, spec)).toBe(21);
  });

  it.each([0, -3, 22, 99, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back to 1 for %p rather than erroring",
    (value) => {
      /**
       * AC4 names 0, 99 and nothing. The failure mode is chosen deliberately:
       * a refused form costs a retype, a silently-wrong offset costs a sheet of
       * stationery. So junk degrades to the safe position, never to a blank
       * sheet or an exception.
       */
      expect(normaliseStartPosition(value, spec)).toBe(1);
    }
  );

  it("floors a fractional position rather than rounding up past the end", () => {
    expect(normaliseStartPosition(6.9, spec)).toBe(6);
    // 21.4 floors to 21, which IS on the sheet — it must not become 22.
    expect(normaliseStartPosition(21.4, spec)).toBe(21);
  });

  it("bounds by the CHOSEN stationery, not a constant", () => {
    // 40 is a real position on the 70-up sheet and nonsense on the 21-up one.
    expect(normaliseStartPosition(40, LABEL_SHEETS["lp70-25s"])).toBe(40);
    expect(normaliseStartPosition(40, LABEL_SHEETS.l7160)).toBe(1);
  });
});

describe("paginateLabels with a start position (US-002)", () => {
  const spec = LABEL_SHEETS.l7160; // 21 per sheet

  it("leaves the skipped slots blank and starts the first item at position 6 (AC1)", () => {
    const pages = paginateLabels(["a", "b", "c"], spec, 6);

    expect(pages).toHaveLength(1);
    // Five blanks, then the items — real grid cells, so the browser does the
    // row wrapping rather than a CSS offset that breaks at the row edge.
    expect(pages[0].slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(pages[0][5]).toBe("a");
  });

  it("offsets ONLY the first sheet (AC2)", () => {
    const items = Array.from({ length: 20 }, (_, index) => index);

    const pages = paginateLabels(items, spec, 6);

    /**
     * The story's worked example: 20 items from position 6 on a 21-up sheet →
     * 16 on sheet one, 4 on sheet two starting at position 1. Repeating the
     * offset on every page would waste far more than it saves, which is the
     * opposite of this story's purpose.
     */
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(21);
    expect(pages[0].filter((slot) => slot !== null)).toHaveLength(16);
    expect(pages[1]).toHaveLength(4);
    expect(pages[1][0]).toBe(16);
  });

  it("never drops an item when the sheet is offset", () => {
    const items = Array.from({ length: 50 }, (_, index) => index);

    const pages = paginateLabels(items, spec, 13);

    expect(pages.flat().filter((slot) => slot !== null)).toEqual(items);
  });

  it("fills exactly one page when the remaining slots match the item count", () => {
    // 21-up sheet, starting at 15 → 7 slots left (15..21).
    const items = Array.from({ length: 7 }, (_, index) => index);

    const pages = paginateLabels(items, spec, 15);

    // NOT a second, empty sheet.
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(21);
  });

  it("normalises a junk start position rather than trusting it", () => {
    // Defence in depth: the field normalises too, but a caller that forgets
    // must not produce a page of 99 blanks.
    const pages = paginateLabels(["a"], spec, 99);

    expect(pages[0][0]).toBe("a");
  });

  it("still produces no pages for an empty selection, offset or not", () => {
    expect(paginateLabels([], spec, 6)).toEqual([]);
  });

  it("defaults to position 1, so US-001's behaviour is unchanged", () => {
    const items = ["a", "b"];

    expect(paginateLabels(items, spec)).toEqual([items]);
  });
});

describe("positionToCell (AC3)", () => {
  it("numbers left-to-right, then top-to-bottom", () => {
    const spec = LABEL_SHEETS.l7160; // 3 columns

    /**
     * The way the sheet reads, and the way every stationery datasheet numbers
     * its own template. Numbering DOWN columns instead would put the labels in
     * the right slots on screen and the wrong ones on paper.
     */
    expect(positionToCell(1, spec)).toEqual({ row: 0, column: 0 });
    expect(positionToCell(3, spec)).toEqual({ row: 0, column: 2 });
    expect(positionToCell(4, spec)).toEqual({ row: 1, column: 0 });
    expect(positionToCell(21, spec)).toEqual({ row: 6, column: 2 });
  });
});

/* -------------------------------------------------------------------------- *
 *  US-003 — printer calibration                                               *
 * -------------------------------------------------------------------------- */

describe("offsetLimitsMm (AC4)", () => {
  it("bounds the nudge by the stationery's OWN margin, not a constant", () => {
    /**
     * The finding that made this per-format. L7163 has 4.65 mm of side margin,
     * so a flat ±10 mm would let a "calibration" push an entire column off the
     * left edge — wasting the sheet this story exists to save.
     */
    const l7163 = offsetLimitsMm(LABEL_SHEETS.l7163);
    expect(l7163.xMm).toBeCloseTo(4.15, 2); // 4.65 − 0.5 safety
    expect(l7163.xMm).toBeLessThan(MAX_OFFSET_MM);
  });

  it("caps at MAX_OFFSET_MM when the margin is generous", () => {
    // The 25 mm square has 17.5 mm of slack; the cap wins, not the margin.
    const square = offsetLimitsMm(LABEL_SHEETS["lp70-25s"]);
    expect(square.xMm).toBe(MAX_OFFSET_MM);
    expect(square.yMm).toBe(MAX_OFFSET_MM);
  });

  it.each(Object.values(LABEL_SHEETS))(
    "$id can never be nudged off the page",
    (spec) => {
      const limits = offsetLimitsMm(spec);

      // The whole point: margin − maxNudge must leave paper on the outside.
      expect(spec.marginLeftMm - limits.xMm).toBeGreaterThan(0);
      expect(spec.marginTopMm - limits.yMm).toBeGreaterThan(0);
    }
  );
});

describe("clampOffset (AC4)", () => {
  const spec = LABEL_SHEETS.l7163;

  it("clamps an absurd offset into range in both directions", () => {
    const limits = offsetLimitsMm(spec);

    expect(clampOffset({ xMm: 500, yMm: -500 }, spec)).toEqual({
      xMm: limits.xMm,
      yMm: -limits.yMm,
    });
  });

  it("leaves a sane offset alone", () => {
    expect(clampOffset({ xMm: 2, yMm: -1.5 }, spec)).toEqual({
      xMm: 2,
      yMm: -1.5,
    });
  });

  it("zeroes non-finite values instead of propagating NaN into the CSS", () => {
    /**
     * `NaN` reaches the renderer as `paddingLeft: "NaNmm"`, which the browser
     * drops — silently reverting to an UNCALIBRATED sheet while the field still
     * shows a value. Zeroing is the same visual result, honestly stated.
     */
    expect(clampOffset({ xMm: Number.NaN, yMm: 3 }, spec)).toEqual({
      xMm: 0,
      yMm: 3,
    });
  });

  it("re-clamps when the stationery changes under a stored offset", () => {
    // Saved while the roomy 25 mm square was selected…
    const saved = { xMm: 9, yMm: 9 };

    // …then applied to L7163, which cannot take it.
    const applied = clampOffset(saved, LABEL_SHEETS.l7163);

    /**
     * This is why clamping happens on READ as well as on write. Without it the
     * stored value would be re-applied unclamped after a format switch and
     * print off the page — with the user believing they were calibrated.
     */
    expect(applied.xMm).toBeLessThan(saved.xMm);
    expect(applied.xMm).toBeCloseTo(4.15, 2);
  });
});

describe("nextStartPosition (AC5)", () => {
  it("advances to the next free slot on a part-used sheet", () => {
    // The story's example: 20 items from position 6 on a 21-up sheet. 16 land
    // on sheet one, 4 on sheet two — so the next free slot is 5.
    expect(nextStartPosition(6, 20, 21)).toBe(5);
  });

  it("wraps to 1 when the print exactly fills the sheet", () => {
    /**
     * The off-by-one this function exists to get right: filling the last slot
     * leaves the NEXT sheet's position 1 free, not position 22 of a 21-slot
     * sheet — which `normaliseStartPosition` would then reject back to 1
     * anyway, but only after showing the user a number that does not exist.
     */
    expect(nextStartPosition(1, 21, 21)).toBe(1);
    expect(nextStartPosition(6, 16, 21)).toBe(1);
  });

  it("wraps across several sheets", () => {
    // 50 items from position 1 on a 21-up sheet: 2 full sheets + 8 → next is 9.
    expect(nextStartPosition(1, 50, 21)).toBe(9);
  });

  it("does not move when nothing was printed", () => {
    expect(nextStartPosition(6, 0, 21)).toBe(6);
  });

  it("always returns a position that is ON the sheet", () => {
    for (let printed = 0; printed <= 100; printed += 1) {
      const next = nextStartPosition(7, printed, 21);
      expect(next).toBeGreaterThanOrEqual(1);
      expect(next).toBeLessThanOrEqual(21);
    }
  });
});
