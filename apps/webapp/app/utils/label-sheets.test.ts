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
  gridHeightMm,
  gridWidthMm,
  isLabelSheetId,
  labelsPerSheet,
  paginateLabels,
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
