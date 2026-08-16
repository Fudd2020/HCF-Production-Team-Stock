/**
 * Label stationery specifications, in millimetres.
 *
 * A sheet of labels is a **physical object**, so every dimension here is a real
 * measurement rather than a pixel value or a percentage. The print view lays
 * out a CSS grid directly from these numbers (`~/components/labels/label-sheet`).
 *
 * ## Why millimetres, and why it matters more than it looks
 *
 * The failure mode of label printing is **cumulative**. A fractional error in
 * the row pitch is invisible on row 1 and ruinous by row 7 — and the whole
 * sheet of stationery goes in the bin. So the row and column pitch come from
 * the stationery's published dimensions, the page margins are stated
 * explicitly, and nothing is left to the browser's defaults.
 *
 * ## The numbers are self-consistent — check that they still are
 *
 * For each spec, `columns × labelWidthMm + (columns - 1) × columnGapMm +
 * 2 × marginLeftMm` must equal exactly {@link A4_WIDTH_MM}, and the same
 * arithmetic down the page must equal {@link A4_HEIGHT_MM}. That is asserted in
 * `label-sheets.test.ts`, which is the cheapest guard there is against a typo
 * that would otherwise only surface on paper.
 *
 * ⚠️ **Self-consistent is not the same as correct.** The arithmetic proves the
 * grid fills an A4 page; it does not prove it matches the stationery in the
 * printer. Verify against the product's own datasheet before the first real
 * print — see `Requirements/label-printing/DECISIONS.md` #4.
 *
 * @see {@link file://./../components/labels/label-sheet.tsx} the renderer
 * @see {@link file://./../components/labels/print-labels-dialog.tsx} the UI
 */

/**
 * Ceiling on one print run (AC10).
 *
 * **Deliberately higher than the QR ZIP download's 100, and not copied from
 * it.** That limit exists because the download rasterises every label in the
 * browser with `html-to-image`, which is the expensive part. A print sheet
 * renders live DOM — the QR is an `<img>` the browser already has — so the
 * client cost is roughly nil and the server cost is one batched query plus N
 * small `sharp` conversions.
 *
 * 250 is a little over three full sheets of the 70-up primary stationery, and
 * about twelve sheets of the 21-up. It is a judgement, not a measurement:
 * ⚠️ **time a real 250-item run during QA** and move this if it drags.
 *
 * Lives here rather than beside the endpoint that enforces it because the
 * dialog needs it too, and importing a *value* from a route module would drag
 * that route's server imports into the client bundle
 * (`.claude/rules/no-server-module-in-route-client-exports.md`).
 */
export const MAX_LABELS_PER_PRINT = 250;

/** A4 page width in millimetres. */
export const A4_WIDTH_MM = 210;

/** A4 page height in millimetres. */
export const A4_HEIGHT_MM = 297;

/** The stationery formats we lay out for. */
export type LabelSheetId = "lp70-25s" | "l7160" | "l7163";

/**
 * How a single label arranges its contents.
 *
 * - `stacked` — QR above the ID. The only thing that fits on a small square.
 * - `side-by-side` — QR on the left, name and ID stacked to its right. Uses the
 *   width of an oblong label, which lets the QR be larger *and* leaves room for
 *   a readable name.
 */
type LabelLayout = "stacked" | "side-by-side";

/** Everything the renderer needs to lay one stationery format out. */
export type LabelSheetSpec = {
  id: LabelSheetId;
  /** Shown in the size picker. */
  name: string;
  /** One line of "what is this for", shown under the name. */
  description: string;

  /** Physical label dimensions. */
  labelWidthMm: number;
  labelHeightMm: number;

  /** Grid shape. `columns × rows` is the labels-per-sheet count. */
  columns: number;
  rows: number;

  /** Distance from the page edge to the first label. */
  marginTopMm: number;
  marginLeftMm: number;

  /** Space *between* labels. Many formats butt up against each other (0). */
  columnGapMm: number;
  rowGapMm: number;

  /** Edge length of the square QR image. */
  qrSizeMm: number;
  /** Breathing room inside the label so nothing touches the die-cut edge. */
  paddingMm: number;

  layout: LabelLayout;

  /**
   * Whether there is room for the item's name.
   *
   * `false` for the 25 mm square — see `DECISIONS.md` #5. The consequence is
   * real: on a QR-only label you cannot tell four identical XLRs apart by eye,
   * only by scanning. That is accepted, and it is why the oblong sizes exist.
   */
  showsName: boolean;
  /** Lines the name may wrap to before it is truncated. Ignored when `showsName`. */
  nameLines: number;

  /** Print type sizes, in points. */
  nameFontPt: number;
  idFontPt: number;
};

/**
 * The three supported formats (`DECISIONS.md` #4).
 *
 * Size 1 is Neil's pick; sizes 2 and 3 are the two most widely stocked A4 label
 * formats, chosen so he is never stuck for stationery.
 */
export const LABEL_SHEETS: Record<LabelSheetId, LabelSheetSpec> = {
  /**
   * Label Planet LP70/25S geometry — 70 per sheet.
   *
   * Margins are derived rather than looked up: 7 × 25 = 175 mm across a 210 mm
   * page leaves 35 mm, split evenly; 10 × 25 = 250 mm down a 297 mm page leaves
   * 47 mm, split evenly. No gaps between labels.
   */
  "lp70-25s": {
    id: "lp70-25s",
    name: "25 × 25 mm square",
    description: "70 per sheet (7 × 10) — cables and small accessories",
    labelWidthMm: 25,
    labelHeightMm: 25,
    columns: 7,
    rows: 10,
    marginTopMm: 23.5,
    marginLeftMm: 17.5,
    columnGapMm: 0,
    rowGapMm: 0,
    qrSizeMm: 18,
    paddingMm: 1,
    layout: "stacked",
    // No room for a name at this size — DECISIONS.md #5.
    showsName: false,
    nameLines: 0,
    nameFontPt: 5,
    idFontPt: 5.5,
  },

  /** Avery L7160 — 21 per sheet. The workhorse for most gear. */
  l7160: {
    id: "l7160",
    name: "63.5 × 38.1 mm (Avery L7160)",
    description: "21 per sheet (3 × 7) — the workhorse, most gear",
    labelWidthMm: 63.5,
    labelHeightMm: 38.1,
    columns: 3,
    rows: 7,
    marginTopMm: 15.15,
    marginLeftMm: 7.21,
    columnGapMm: 2.54,
    rowGapMm: 0,
    qrSizeMm: 30,
    paddingMm: 2,
    layout: "side-by-side",
    showsName: true,
    nameLines: 3,
    nameFontPt: 7,
    idFontPt: 6.5,
  },

  /** Avery L7163 — 14 per sheet. Kits, racks and flight cases. */
  l7163: {
    id: "l7163",
    name: "99.1 × 38.1 mm (Avery L7163)",
    description: "14 per sheet (2 × 7) — kits, racks and flight cases",
    labelWidthMm: 99.1,
    labelHeightMm: 38.1,
    columns: 2,
    rows: 7,
    marginTopMm: 15.15,
    marginLeftMm: 4.65,
    columnGapMm: 2.5,
    rowGapMm: 0,
    qrSizeMm: 30,
    paddingMm: 2.5,
    layout: "side-by-side",
    showsName: true,
    nameLines: 3,
    nameFontPt: 9,
    idFontPt: 8,
  },
};

/**
 * The format the picker opens on — Neil's primary stationery (`DECISIONS.md` #4).
 */
export const DEFAULT_LABEL_SHEET_ID: LabelSheetId = "lp70-25s";

/** The formats in the order they should be offered. */
export const LABEL_SHEET_OPTIONS: LabelSheetSpec[] = [
  LABEL_SHEETS["lp70-25s"],
  LABEL_SHEETS.l7160,
  LABEL_SHEETS.l7163,
];

/**
 * Whether a string names a supported format.
 *
 * @param value - Candidate id, typically from a select or a query param
 * @returns `true` if {@link LABEL_SHEETS} has a spec for it
 */
export function isLabelSheetId(value: string): value is LabelSheetId {
  return Object.prototype.hasOwnProperty.call(LABEL_SHEETS, value);
}

/**
 * How many labels one sheet of this stationery holds.
 *
 * @param spec - The stationery format
 * @returns `columns × rows`
 */
export function labelsPerSheet(spec: LabelSheetSpec): number {
  return spec.columns * spec.rows;
}

/**
 * Normalises a user-supplied start position (US-002 AC4).
 *
 * `0`, a number past the end of the sheet, a blank field and outright junk all
 * fall back to **1** rather than erroring. The reason is the story's own: a
 * refused form costs a retype, but a silently-wrong offset costs a sheet of
 * stationery — so the failure mode is chosen to be the cheap one.
 *
 * @param value - Whatever came out of the input (may be `NaN`, `""`, negative)
 * @param spec - The stationery, which bounds the highest legal position
 * @returns A position between 1 and `labelsPerSheet(spec)` inclusive
 */
export function normaliseStartPosition(
  value: number,
  spec: LabelSheetSpec
): number {
  if (!Number.isFinite(value)) return 1;

  const position = Math.floor(value);
  if (position < 1 || position > labelsPerSheet(spec)) return 1;

  return position;
}

/**
 * Splits a flat list of items into one array per printed page.
 *
 * US-001 AC4: 60 items onto 21-up stationery must produce three correctly
 * aligned pages, with no label straddling a page boundary. Chunking here —
 * rather than letting the browser flow a single long grid across pages — is
 * what guarantees that, because a CSS grid broken by the printer does not
 * respect the top margin of the next sheet.
 *
 * ## Part-used sheets (US-002)
 *
 * `startPosition` leaves that many slots blank at the front, so the first item
 * lands where the user's stationery actually starts. Blanks are `null` entries
 * in the first page, which keeps them real grid cells — the alternative,
 * offsetting with CSS, breaks the moment a label wraps to the next row.
 *
 * ⚠️ **Only the FIRST page is offset** (AC2). A second sheet is a fresh one, so
 * repeating the offset on every page would waste far more than it saves — the
 * exact opposite of this story's purpose.
 *
 * @param items - Items to print, in the order they should appear
 * @param spec - The stationery format, which determines the chunk size
 * @param startPosition - 1-based slot the first item occupies on sheet one.
 *   Normalise it with {@link normaliseStartPosition} before calling
 * @returns One array per page; `null` marks a deliberately skipped slot. An
 *   empty input yields no pages at all, never one blank page
 */
export function paginateLabels<T>(
  items: T[],
  spec: LabelSheetSpec,
  startPosition = 1
): (T | null)[][] {
  if (items.length === 0) {
    return [];
  }

  const perSheet = labelsPerSheet(spec);
  const leadingBlanks = normaliseStartPosition(startPosition, spec) - 1;

  // The first sheet holds fewer labels by exactly the number skipped.
  const firstPageCapacity = perSheet - leadingBlanks;

  const pages: (T | null)[][] = [
    [
      ...(Array.from({ length: leadingBlanks }) as null[]).fill(null),
      ...items.slice(0, firstPageCapacity),
    ],
  ];

  for (let index = firstPageCapacity; index < items.length; index += perSheet) {
    pages.push(items.slice(index, index + perSheet));
  }

  return pages;
}

/**
 * Total printed width of the label grid, excluding page margins.
 *
 * @param spec - The stationery format
 * @returns Width in millimetres
 */
export function gridWidthMm(spec: LabelSheetSpec): number {
  return (
    spec.columns * spec.labelWidthMm + (spec.columns - 1) * spec.columnGapMm
  );
}

/**
 * Total printed height of the label grid, excluding page margins.
 *
 * @param spec - The stationery format
 * @returns Height in millimetres
 */
export function gridHeightMm(spec: LabelSheetSpec): number {
  return spec.rows * spec.labelHeightMm + (spec.rows - 1) * spec.rowGapMm;
}

/* -------------------------------------------------------------------------- *
 *  US-003 — printer calibration                                              *
 * -------------------------------------------------------------------------- */

/**
 * The largest calibration nudge offered, in millimetres.
 *
 * Printer drift is a millimetre or two in practice; 10 mm is generous headroom
 * without being an invitation to "fix" a wrong stationery choice by shoving the
 * grid halfway across the page.
 */
export const MAX_OFFSET_MM = 10;

/** A printer's measured drift, applied to the whole grid. */
export type LabelSheetOffset = {
  /** Positive moves the grid RIGHT. */
  xMm: number;
  /** Positive moves the grid DOWN. */
  yMm: number;
};

/** No calibration — what an uncalibrated printer gets. */
export const ZERO_OFFSET: LabelSheetOffset = { xMm: 0, yMm: 0 };

/**
 * Keeps the grid on the paper by never letting it be nudged into the margin.
 *
 * Since the grid is centred, the free space on each side equals the margin, so
 * that is the true bound — and it is **per format**, which a flat number cannot
 * express. On the 25 mm square there is 17.5 mm of slack; on Avery L7163 there
 * is **4.65 mm**. A single ±10 mm clamp would let a "calibration" push a whole
 * column of L7163 labels clean off the left edge, wasting the sheet this story
 * exists to save.
 *
 * `SAFETY_MM` keeps a hair of paper beyond the outermost label so a nudge to
 * the limit still prints something rather than clipping at the page edge.
 *
 * @param spec - The stationery being printed onto
 * @returns The largest legal nudge in each axis, in millimetres
 */
export function offsetLimitsMm(spec: LabelSheetSpec): {
  xMm: number;
  yMm: number;
} {
  const SAFETY_MM = 0.5;

  return {
    xMm: Math.max(0, Math.min(MAX_OFFSET_MM, spec.marginLeftMm - SAFETY_MM)),
    yMm: Math.max(0, Math.min(MAX_OFFSET_MM, spec.marginTopMm - SAFETY_MM)),
  };
}

/**
 * Clamps a stored or typed offset into what this stationery can actually take
 * (US-003 AC4).
 *
 * Applied on read as well as on write, deliberately: a value persisted while
 * the 25 mm format was selected (±17 mm of room) would otherwise be re-applied
 * unclamped after switching to L7163, and print off the page.
 *
 * @param offset - The candidate offset, possibly from `localStorage` or a field
 * @param spec - The stationery it is about to be applied to
 * @returns The offset, clamped per axis and with non-finite values zeroed
 */
export function clampOffset(
  offset: LabelSheetOffset,
  spec: LabelSheetSpec
): LabelSheetOffset {
  const limits = offsetLimitsMm(spec);

  const clamp = (value: number, limit: number) => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(-limit, Math.min(limit, value));
  };

  return {
    xMm: clamp(offset.xMm, limits.xMm),
    yMm: clamp(offset.yMm, limits.yMm),
  };
}

/**
 * Where a 1-based slot sits in the grid (US-002 AC3).
 *
 * Numbering runs **left-to-right, then top-to-bottom** — the way the sheet
 * reads, and the way every label-stationery datasheet numbers its own template.
 *
 * @param position - 1-based slot number
 * @param spec - The stationery, which supplies the column count
 * @returns Zero-based row and column
 */
export function positionToCell(
  position: number,
  spec: LabelSheetSpec
): { row: number; column: number } {
  const index = position - 1;

  return {
    row: Math.floor(index / spec.columns),
    column: index % spec.columns,
  };
}

/**
 * Where the next print should start, given where this one finished (US-002 AC5).
 *
 * Wraps within the sheet, because a print that fills the last slot leaves the
 * NEXT sheet's position 1 free — not position 22 of a sheet with 21 slots.
 *
 * ⚠️ **Only meaningful for the session that just printed.** See the caller: the
 * value lives in React state and cannot survive a reload, which is what makes
 * "never silently persist across days" structural rather than a promise.
 *
 * @param startPosition - Where this print began, 1-based
 * @param printed - How many labels it laid down
 * @param perSheet - Capacity of the stationery
 * @returns The next free slot on the last sheet used, 1-based
 */
export function nextStartPosition(
  startPosition: number,
  printed: number,
  perSheet: number
): number {
  return ((startPosition - 1 + printed) % perSheet) + 1;
}
