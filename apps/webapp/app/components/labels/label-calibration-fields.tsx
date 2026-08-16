/**
 * Printer calibration — the alignment test and the nudge (US-003).
 *
 * Printers drift. The same file on two printers lands a millimetre or two
 * apart, and the error is invisible on screen. Every mature label tool has
 * this; the ones that do not are the ones people stop trusting after the second
 * binned sheet.
 *
 * ## Two controls, in the order they are used
 *
 * 1. **Print alignment test** — a page of numbered outlines on plain paper,
 *    held against a real sheet of stationery. This comes first because until
 *    you have measured the drift you have nothing to type into (2).
 * 2. **Nudge** — horizontal and vertical millimetres, remembered per browser.
 *
 * ⚠️ **The limits are per stationery, not a fixed number.** See `offsetLimitsMm`
 * — L7163 has 4.65 mm of side margin, so a flat ±10 mm would let a
 * "calibration" push a column clean off the paper.
 *
 * @see {@link file://./use-label-offset.ts} for why this persists in the browser
 */

import { Button } from "~/components/shared/button";
import type { LabelSheetOffset, LabelSheetSpec } from "~/utils/label-sheets";
import { offsetLimitsMm } from "~/utils/label-sheets";

type LabelCalibrationFieldsProps = {
  offset: LabelSheetOffset;
  onChange: (next: LabelSheetOffset) => void;
  /** Prints the numbered outline sheet (AC1). */
  onPrintAlignmentTest: () => void;
  spec: LabelSheetSpec;
  disabled?: boolean;
};

/** One millimetre nudge input. */
function OffsetInput({
  id,
  label,
  hint,
  value,
  limit,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  limit: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={0.5}
        min={-limit}
        max={limit}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-describedby={`${id}-hint`}
        className="mt-1 w-24 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-gray-50"
      />
      <p id={`${id}-hint`} className="mt-1 text-xs text-gray-500">
        {hint} Max ±{limit.toFixed(1)} mm on this sheet.
      </p>
    </div>
  );
}

/**
 * The calibration block.
 *
 * @param props - See {@link LabelCalibrationFieldsProps}
 * @returns The alignment-test button and the two nudge fields
 */
export function LabelCalibrationFields({
  offset,
  onChange,
  onPrintAlignmentTest,
  spec,
  disabled,
}: LabelCalibrationFieldsProps) {
  const limits = offsetLimitsMm(spec);
  const isCalibrated = offset.xMm !== 0 || offset.yMm !== 0;

  return (
    <div className="mb-4 rounded-md border border-gray-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-700">Printer alignment</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={onPrintAlignmentTest}
        >
          Print alignment test
        </Button>
      </div>

      <p className="mt-1 text-xs text-gray-500">
        Print the test on <strong>plain paper</strong> and hold it against a
        sheet of your labels. If the outlines sit off the labels, nudge the grid
        below and test again — before you put stationery in the printer.
      </p>

      <div className="mt-3 flex flex-wrap gap-4">
        <OffsetInput
          id="offset-x"
          label="Move right (mm)"
          hint="Negative moves left."
          value={offset.xMm}
          limit={limits.xMm}
          disabled={disabled}
          onChange={(xMm) => onChange({ ...offset, xMm })}
        />
        <OffsetInput
          id="offset-y"
          label="Move down (mm)"
          hint="Negative moves up."
          value={offset.yMm}
          limit={limits.yMm}
          disabled={disabled}
          onChange={(yMm) => onChange({ ...offset, yMm })}
        />
      </div>

      {isCalibrated ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-xs text-gray-600">
            Saved for this browser and applied to every print.
          </p>
          <Button
            type="button"
            variant="link"
            className="!p-0 text-xs"
            disabled={disabled}
            onClick={() => onChange({ xMm: 0, yMm: 0 })}
          >
            Reset
          </Button>
        </div>
      ) : null}
    </div>
  );
}
