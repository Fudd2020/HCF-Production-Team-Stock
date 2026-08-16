/**
 * The stationery size picker (US-001).
 *
 * Extracted from `print-labels-dialog.tsx` when US-002 and US-003 added their
 * own controls — the dialog carried a deferred `no-giant-component` note saying
 * to split once their shape was known, and this is that split.
 *
 * @see {@link file://./../../utils/label-sheets.ts} for the three formats
 */

import type { LabelSheetId } from "~/utils/label-sheets";
import { LABEL_SHEET_OPTIONS } from "~/utils/label-sheets";
import { tw } from "~/utils/tw";

type LabelSheetPickerProps = {
  value: LabelSheetId;
  onChange: (next: LabelSheetId) => void;
  disabled?: boolean;
};

/**
 * A radio group of the supported label formats.
 *
 * @param props - See {@link LabelSheetPickerProps}
 * @returns The fieldset of format options
 */
export function LabelSheetPicker({
  value,
  onChange,
  disabled,
}: LabelSheetPickerProps) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-sm font-medium text-gray-700">
        Label size
      </legend>

      {/*
        Both text spans are DIRECT children of the label, not wrapped in a
        layout element — `jsx-a11y/label-has-associated-control` only looks two
        levels deep, so a wrapper makes the label read as having no accessible
        text. The two-column grid does the stacking instead.
      */}
      <div className="flex flex-col gap-2">
        {LABEL_SHEET_OPTIONS.map((option) => (
          <label
            key={option.id}
            className={tw(
              "grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 rounded border p-3",
              option.id === value
                ? "border-primary-500 bg-primary-25"
                : "border-gray-300"
            )}
          >
            <input
              type="radio"
              name="label-sheet"
              value={option.id}
              checked={option.id === value}
              disabled={disabled}
              onChange={() => onChange(option.id)}
              className="row-span-2 mt-1"
            />
            <span className="text-sm font-medium text-gray-900">
              {option.name}
            </span>
            <span className="text-xs text-gray-500">{option.description}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
