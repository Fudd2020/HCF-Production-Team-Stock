/**
 * "Start at position N" — finishing a part-used sheet (US-002).
 *
 * A sheet of 21 used five at a time is four sheets binned for every one used,
 * and Neil is labelling in evenings over weeks, so part-used sheets are the
 * normal case rather than the edge case.
 *
 * ## The map is the feature, not decoration
 *
 * AC3 requires the UI to make clear which corner is position 1. A number on its
 * own does not: the user is holding a physical sheet and has to decide whether
 * counting starts top-left or bottom-left, and along rows or down columns. The
 * miniature grid answers all three at a glance and highlights the slot they
 * just typed, so a mistake is visible **before** it reaches paper rather than
 * after.
 *
 * @see {@link file://./../../utils/label-sheets.ts} for the numbering rule
 */

import type { LabelSheetSpec } from "~/utils/label-sheets";
import { labelsPerSheet, normaliseStartPosition } from "~/utils/label-sheets";
import { tw } from "~/utils/tw";

type LabelStartPositionFieldProps = {
  /** Raw field text, kept unparsed so typing "1" on the way to "12" is not fought. */
  value: string;
  onChange: (next: string) => void;
  /** The stationery, which bounds the highest legal position. */
  spec: LabelSheetSpec;
  /** True when this value was carried over from the previous print (AC5). */
  carriedOver: boolean;
  disabled?: boolean;
};

/**
 * A miniature of the sheet, with the chosen slot filled.
 *
 * Skipped slots are outlined and the starting slot is solid, so the picture
 * reads as "these are already used, yours begins here".
 *
 * @param props.startPosition - The normalised 1-based slot
 * @param props.spec - The stationery whose grid shape is drawn
 * @returns A non-interactive diagram, hidden from assistive tech (the field's
 * own hint carries the same fact in words)
 */
function SheetMap({
  startPosition,
  spec,
}: {
  startPosition: number;
  spec: LabelSheetSpec;
}) {
  const total = labelsPerSheet(spec);

  return (
    <div
      aria-hidden="true"
      className="inline-grid shrink-0 gap-[2px] rounded border border-gray-200 bg-white p-1"
      style={{
        gridTemplateColumns: `repeat(${spec.columns}, minmax(0, 1fr))`,
        width: `${Math.min(120, spec.columns * 14)}px`,
      }}
    >
      {Array.from({ length: total }, (_, index) => {
        const position = index + 1;
        const isSkipped = position < startPosition;
        const isStart = position === startPosition;

        return (
          <span
            key={position}
            className={tw(
              "aspect-square rounded-[1px] border",
              isStart
                ? "border-primary-500 bg-primary-500"
                : isSkipped
                ? "border-gray-200 bg-gray-100"
                : "border-gray-300 bg-white"
            )}
          />
        );
      })}
    </div>
  );
}

/**
 * The start-position control and its sheet map.
 *
 * @param props - See {@link LabelStartPositionFieldProps}
 * @returns The labelled field, the map, and the fallback hint when one applies
 */
export function LabelStartPositionField({
  value,
  onChange,
  spec,
  carriedOver,
  disabled,
}: LabelStartPositionFieldProps) {
  const perSheet = labelsPerSheet(spec);
  const effective = normaliseStartPosition(Number(value), spec);

  /**
   * AC4 — `0`, `99` and a blank field all fall back to 1. Saying so is what
   * stops it reading as the app ignoring the input: the user typed something,
   * and something else is going to happen.
   */
  const fellBack = value.trim() !== "" && String(effective) !== value.trim();

  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-sm font-medium text-gray-700">
        Start at position
      </legend>

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={perSheet}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            aria-describedby="start-position-hint"
            className="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-gray-50"
          />

          <p id="start-position-hint" className="mt-2 text-xs text-gray-500">
            Counting left to right, top to bottom — position 1 is the top-left
            label. This sheet holds {perSheet}.
          </p>

          {fellBack ? (
            <p className="mt-1 text-xs text-warning-600">
              That is not a position on this sheet, so printing will start at 1.
            </p>
          ) : null}

          {carriedOver && !fellBack ? (
            <p className="mt-1 text-xs text-gray-500">
              Picked up from your last print. Change it if you have put a fresh
              sheet in.
            </p>
          ) : null}
        </div>

        <SheetMap startPosition={effective} spec={spec} />
      </div>
    </fieldset>
  );
}
