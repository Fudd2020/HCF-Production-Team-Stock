/**
 * The printable sheet — A4 pages of labels laid out in millimetres (US-001).
 *
 * This component is never *seen*. It is rendered off-screen and handed to
 * `react-to-print`, which clones it into a print iframe. Everything here is
 * therefore sized for paper, not for a viewport: no Tailwind spacing scale, no
 * `rem`, no percentages — only `mm` and `pt`, taken from
 * {@link file://./../../utils/label-sheets.ts}.
 *
 * ## Three things that will silently ruin a sheet
 *
 * 1. **Flowing one long grid across pages.** The printer breaks it wherever it
 *    likes, so page 2 starts at the paper edge instead of the stationery's top
 *    margin. Fixed by chunking with `paginateLabels` and giving each page its
 *    own fixed-size box (AC4).
 * 2. **Browser print scaling.** "Fit to page" quietly shrinks everything by a
 *    few percent, which reads as a printer problem rather than a settings one.
 *    We cannot disable it, so {@link CalibrationRuler} prints a 100 mm
 *    reference the user can measure — turning a subtle offset into an obvious
 *    one (AC3).
 * 3. **Smoothed QR images.** The source PNG is smaller than the printed square,
 *    and a bilinear upscale rounds off the module corners. `imageRendering:
 *    pixelated` keeps the edges square so scanners read it at arm's length (AC6).
 *
 * ## Why the styles are inline
 *
 * `react-doctor` flags `no-inline-exhaustive-style` four times here, and the
 * finding stays. Every value is a physical measurement computed from the chosen
 * stationery — `${spec.labelWidthMm}mm`, `${spec.qrSizeMm}mm` — so there is no
 * fixed class to extract them to, and Tailwind's spacing scale has no
 * millimetre units. Moving them to CSS would mean generating a stylesheet per
 * format, which is strictly worse.
 *
 * @see {@link file://./print-labels-dialog.tsx} the launcher
 */

import { forwardRef } from "react";
import type { CSSProperties } from "react";

import type { PrintableLabelItem } from "~/routes/api+/labels.get-items-for-print";
import type { LabelSheetOffset, LabelSheetSpec } from "~/utils/label-sheets";
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  ZERO_OFFSET,
  clampOffset,
  gridHeightMm,
  labelsPerSheet,
  paginateLabels,
} from "~/utils/label-sheets";

/**
 * Print stylesheet handed to `react-to-print`.
 *
 * `margin: 0` is the important part: we position the grid ourselves from the
 * stationery's own margins, so any margin the browser adds would shift every
 * label on every page. `print-color-adjust` stops the QR being "helpfully"
 * lightened.
 */
export const LABEL_SHEET_PAGE_STYLE = `
  @page {
    size: A4;
    margin: 0;
  }
  @media print {
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
`;

/** Length of the printed reference line. A round number is easy to measure. */
const RULER_LENGTH_MM = 100;

type LabelSheetProps = {
  /** Items to print, in the order they should appear. */
  items: PrintableLabelItem[];
  /** The stationery being printed onto. */
  spec: LabelSheetSpec;
  /**
   * Workspace preference. `SAM_ID` prints the sequential id where the item has
   * one; everything else prints the QR id.
   */
  qrIdDisplayPreference?: string;
  /**
   * 1-based slot the first item takes on sheet ONE (US-002). Later sheets
   * always start at 1 — a fresh sheet has nothing used on it.
   */
  startPosition?: number;
  /** The printer's measured drift (US-003). Re-clamped against `spec` here. */
  offset?: LabelSheetOffset;
  /**
   * Print the calibration sheet instead of the labels (US-003 AC1): one page of
   * numbered outlines and no item data, for holding against real stationery.
   */
  alignmentTest?: boolean;
};

/**
 * Resolves the identifier printed under (or beside) the QR.
 *
 * The id is the one thing on the label that is never truncated — it is what
 * makes the sticker unambiguous when the name has been shortened, and on the
 * 25 mm square it is the *only* text there is.
 *
 * @param item - The item being printed
 * @param qrIdDisplayPreference - Workspace-level id preference
 * @returns The string to print
 */
function resolvePrintedId(
  item: PrintableLabelItem,
  qrIdDisplayPreference?: string
): string {
  if (qrIdDisplayPreference === "SAM_ID" && item.sequentialId) {
    return item.sequentialId;
  }
  return item.qr.id;
}

/**
 * A 100 mm reference line printed in the sheet's bottom margin (AC3).
 *
 * Every supported format leaves at least 15 mm of unlabelled backing paper at
 * the foot of the page, so this lands on waste rather than on a sticker.
 *
 * @param props.bandHeightMm - Height of the empty band it must sit inside
 * @returns The ruler, or `null` when there is not enough room for it
 */
function CalibrationRuler({ bandHeightMm }: { bandHeightMm: number }) {
  // Below this there is no space to print it without touching the last row.
  if (bandHeightMm < 8) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: `${Math.max(2, (bandHeightMm - 6) / 2)}mm`,
        left: 0,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "2mm",
        color: "#666666",
        fontFamily: "sans-serif",
        fontSize: "5pt",
      }}
    >
      <div
        style={{
          width: `${RULER_LENGTH_MM}mm`,
          height: "2mm",
          borderLeft: "0.3mm solid #666666",
          borderRight: "0.3mm solid #666666",
          borderBottom: "0.3mm solid #666666",
        }}
      />
      <span>
        This line must measure exactly {RULER_LENGTH_MM} mm — if it does not,
        print again at 100% scale
      </span>
    </div>
  );
}

/**
 * One label's contents.
 *
 * The two layouts are not cosmetic. `stacked` is the only thing that fits on a
 * 25 mm square (`DECISIONS.md` #5 — no name at that size); `side-by-side` uses
 * the width of an oblong label so the QR can be larger *and* the name readable.
 *
 * @param props.item - The item this label identifies
 * @param props.spec - The stationery, which supplies every dimension
 * @param props.qrIdDisplayPreference - Workspace-level id preference
 * @returns One positioned label
 */
function Label({
  item,
  spec,
  qrIdDisplayPreference,
}: {
  item: PrintableLabelItem;
  spec: LabelSheetSpec;
  qrIdDisplayPreference?: string;
}) {
  const printedId = resolvePrintedId(item, qrIdDisplayPreference);
  const isStacked = spec.layout === "stacked";

  const qrStyle: CSSProperties = {
    width: `${spec.qrSizeMm}mm`,
    height: `${spec.qrSizeMm}mm`,
    // See the file doc — keeps the QR modules square when upscaled.
    imageRendering: "pixelated",
    display: "block",
  };

  const idStyle: CSSProperties = {
    fontFamily: "monospace",
    fontSize: `${spec.idFontPt}pt`,
    lineHeight: 1.1,
    color: "#000000",
    // Never truncated: it is what disambiguates the label.
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        width: `${spec.labelWidthMm}mm`,
        height: `${spec.labelHeightMm}mm`,
        padding: `${spec.paddingMm}mm`,
        boxSizing: "border-box",
        overflow: "hidden",
        display: "flex",
        flexDirection: isStacked ? "column" : "row",
        alignItems: "center",
        justifyContent: isStacked ? "center" : "flex-start",
        gap: isStacked ? "0.5mm" : `${spec.paddingMm}mm`,
        backgroundColor: "#ffffff",
      }}
    >
      <img src={item.qr.src} alt="" style={qrStyle} />

      {isStacked ? (
        <div style={{ ...idStyle, textAlign: "center" }}>{printedId}</div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "1mm",
            // `minWidth: 0` is what allows the name to truncate instead of
            // pushing the QR out of the label.
            minWidth: 0,
            flex: 1,
          }}
        >
          {spec.showsName ? (
            <div
              style={{
                fontFamily: "sans-serif",
                fontSize: `${spec.nameFontPt}pt`,
                fontWeight: 600,
                lineHeight: 1.15,
                color: "#000000",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: spec.nameLines,
                overflow: "hidden",
                // Long unbroken model numbers must wrap rather than overflow.
                overflowWrap: "anywhere",
              }}
            >
              {item.title}
            </div>
          ) : null}
          <div style={idStyle}>{printedId}</div>
        </div>
      )}
    </div>
  );
}

/**
 * One printed slot that is deliberately EMPTY (US-002).
 *
 * A real grid cell, not a CSS offset on the grid itself. Offsetting would break
 * the moment the skipped count wrapped past the end of a row — this cannot,
 * because the browser does the wrapping.
 *
 * @returns An empty cell occupying exactly one label's footprint
 */
function BlankSlot({ spec }: { spec: LabelSheetSpec }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: `${spec.labelWidthMm}mm`,
        height: `${spec.labelHeightMm}mm`,
      }}
    />
  );
}

/**
 * One slot on the alignment test sheet (US-003 AC1).
 *
 * An outline and a position number, no item data. Held to the SAME dimensions
 * as a real label by taking the same `spec` — if this drew its own box the test
 * would prove nothing about the sheet it is meant to be testing.
 *
 * The outline is deliberately hairline and grey: it is printed onto plain paper
 * and held up against the stationery, so it needs to be visible through one
 * sheet without flooding the page with toner.
 *
 * @param props.position - 1-based slot number, printed in the corner
 * @param props.spec - The stationery being calibrated
 * @returns One outlined, numbered slot
 */
function AlignmentSlot({
  position,
  spec,
}: {
  position: number;
  spec: LabelSheetSpec;
}) {
  return (
    <div
      style={{
        width: `${spec.labelWidthMm}mm`,
        height: `${spec.labelHeightMm}mm`,
        boxSizing: "border-box",
        border: "0.2mm solid #999999",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "sans-serif",
        fontSize: `${Math.max(6, spec.idFontPt)}pt`,
        color: "#999999",
      }}
    >
      {position}
    </div>
  );
}

/**
 * One A4 page: a fixed-size box holding up to one sheet's worth of labels.
 *
 * `breakAfter: "page"` on every page but the last is what keeps the printer
 * from flowing rows across a boundary.
 *
 * @param props.pageItems - The slots on this page. `null` is a deliberately
 * skipped position (US-002); on an alignment sheet every entry is `null`
 * @param props.spec - The stationery
 * @param props.isLast - Suppresses the trailing page break, so a single-page
 * print does not emit a blank second sheet
 * @param props.offset - The printer's measured drift, already clamped
 * @param props.alignmentTest - Draw numbered outlines instead of labels
 * @param props.qrIdDisplayPreference - Workspace-level id preference
 * @returns One printed page
 */
function LabelPage({
  pageItems,
  spec,
  isLast,
  offset,
  alignmentTest = false,
  qrIdDisplayPreference,
}: {
  pageItems: (PrintableLabelItem | null)[];
  spec: LabelSheetSpec;
  isLast: boolean;
  offset: LabelSheetOffset;
  alignmentTest?: boolean;
  qrIdDisplayPreference?: string;
}) {
  const bottomBandMm = A4_HEIGHT_MM - spec.marginTopMm - gridHeightMm(spec);

  return (
    <div
      style={{
        position: "relative",
        width: `${A4_WIDTH_MM}mm`,
        height: `${A4_HEIGHT_MM}mm`,
        boxSizing: "border-box",
        /**
         * US-003 AC2 — the printer's drift is applied HERE, to the page's own
         * padding, so it moves the whole grid as one. Applying it per label
         * would move each one relative to its neighbour and shear the sheet.
         *
         * Already clamped by `clampOffset` against this spec's margins, so this
         * can never subtract enough to push the grid off the paper.
         */
        paddingTop: `${spec.marginTopMm + offset.yMm}mm`,
        paddingLeft: `${spec.marginLeftMm + offset.xMm}mm`,
        overflow: "hidden",
        backgroundColor: "#ffffff",
        breakAfter: isLast ? "auto" : "page",
        breakInside: "avoid",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${spec.columns}, ${spec.labelWidthMm}mm)`,
          gridAutoRows: `${spec.labelHeightMm}mm`,
          columnGap: `${spec.columnGapMm}mm`,
          rowGap: `${spec.rowGapMm}mm`,
        }}
      >
        {pageItems.map((item, index) =>
          alignmentTest ? (
            <AlignmentSlot
              key={`slot-${index}`}
              position={index + 1}
              spec={spec}
            />
          ) : item ? (
            <Label
              key={item.id}
              item={item}
              spec={spec}
              qrIdDisplayPreference={qrIdDisplayPreference}
            />
          ) : (
            // A skipped slot on a part-used sheet. Index IS the identity here:
            // blanks are positional and interchangeable by definition.
            <BlankSlot key={`blank-${index}`} spec={spec} />
          )
        )}
      </div>

      <CalibrationRuler bandHeightMm={bottomBandMm} />
    </div>
  );
}

/**
 * The full print job — every page of labels for the current selection.
 *
 * Rendered off-screen by {@link file://./print-labels-dialog.tsx}; the forwarded
 * ref is what `react-to-print` clones.
 *
 * @param props - See {@link LabelSheetProps}
 * @returns All pages, in order
 */
export const LabelSheet = forwardRef<HTMLDivElement, LabelSheetProps>(
  function LabelSheet(
    {
      items,
      spec,
      qrIdDisplayPreference,
      startPosition = 1,
      offset = ZERO_OFFSET,
      alignmentTest = false,
    },
    ref
  ) {
    /**
     * Clamped again here rather than trusted from the caller. The offset can
     * arrive from `localStorage`, which may hold a value saved while a
     * roomier stationery was selected — see `clampOffset`.
     */
    const safeOffset = clampOffset(offset, spec);

    /**
     * The alignment sheet is ONE page of empty slots, numbered — never a page
     * per selected item. It is printed onto plain paper before committing
     * stationery, so its content is the grid itself.
     */
    const pages: (PrintableLabelItem | null)[][] = alignmentTest
      ? [Array.from({ length: labelsPerSheet(spec) }, () => null)]
      : paginateLabels(items, spec, startPosition);

    return (
      <div ref={ref} style={{ backgroundColor: "#ffffff" }}>
        {pages.map((pageItems, index) => (
          <LabelPage
            // Pages have no identity of their own, and the list is derived
            // fresh from `items` on every render — the index IS the identity.
            key={`page-${index}`}
            pageItems={pageItems}
            spec={spec}
            isLast={index === pages.length - 1}
            offset={safeOffset}
            alignmentTest={alignmentTest}
            qrIdDisplayPreference={qrIdDisplayPreference}
          />
        ))}
      </div>
    );
  }
);
