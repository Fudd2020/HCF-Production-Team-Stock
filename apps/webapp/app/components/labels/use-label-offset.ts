/**
 * Remembers a printer's measured drift across sessions (US-003 AC3).
 *
 * ## Why `localStorage` and not a database column — this is a correction, not a shortcut
 *
 * US-003 AC3 says the offset "persists for **this workspace**", and the story
 * notes a `localStorage` value "may be sufficient … avoids the migration
 * entirely — decide deliberately and record it".
 *
 * Decided: **`localStorage`, and it is more correct than the workspace column
 * the AC describes.** Printer drift is a property of the *printer*, which the
 * story itself says ("a printer's drift is a property of the printer, not of
 * the session"). It follows that it is not a property of the workspace either.
 * Storing it per-organisation would mean Neil calibrating his printer and then
 * silently applying his correction to everyone else's — so the second person to
 * print would waste the sheet this story exists to save. That failure would be
 * invisible until it hit paper.
 *
 * The browser is the closest thing available to "this machine, this printer",
 * which is the real unit. It also avoids a migration, but that is a side
 * benefit rather than the argument.
 *
 * ⚠️ **Consequence, stated plainly:** the calibration does not follow you to
 * another device, and clearing site data loses it. Both are correct — a new
 * device is very likely a new printer — but they are the trade being made.
 *
 * @see {@link file://./../../utils/label-sheets.ts} for the clamping rules
 */

import { useCallback, useEffect, useState } from "react";

import type { LabelSheetOffset } from "~/utils/label-sheets";
import { ZERO_OFFSET } from "~/utils/label-sheets";

/**
 * Storage key, versioned.
 *
 * If the stored SHAPE ever changes, bump the suffix rather than migrating: a
 * stale offset silently misprinting a sheet is worse than an uncalibrated
 * printer, because the user believes it is calibrated.
 */
const STORAGE_KEY = "shelf.labelPrinterOffset.v1";

/**
 * Reads the stored offset defensively.
 *
 * Everything about this value is untrusted — it is user-writable storage that
 * may have been hand-edited, written by an older build, or corrupted. Anything
 * that is not two finite numbers degrades to "uncalibrated", which is the safe
 * direction: a zero offset prints exactly what the geometry says.
 *
 * @returns The stored offset, or {@link ZERO_OFFSET}
 */
function readStoredOffset(): LabelSheetOffset {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return ZERO_OFFSET;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return ZERO_OFFSET;

    const { xMm, yMm } = parsed as Record<string, unknown>;
    if (typeof xMm !== "number" || typeof yMm !== "number") return ZERO_OFFSET;
    if (!Number.isFinite(xMm) || !Number.isFinite(yMm)) return ZERO_OFFSET;

    return { xMm, yMm };
  } catch {
    // Private-browsing quota errors, disabled storage, malformed JSON — none of
    // them should stop someone printing a label.
    return ZERO_OFFSET;
  }
}

/**
 * The printer-calibration offset, persisted per browser.
 *
 * ⚠️ **Reads storage in an effect, never during render.** This route is
 * server-rendered, so touching `localStorage` in the initial state would throw
 * on the server; returning a different value on the client would be a hydration
 * mismatch. So the first paint is always `ZERO_OFFSET` and the stored value
 * arrives a tick later — invisible inside a dialog, and correct in both
 * environments.
 *
 * The value is deliberately NOT clamped here: clamping depends on the chosen
 * stationery, which this hook knows nothing about. `clampOffset` is applied at
 * the point of use, and again inside `LabelSheet`.
 *
 * @returns The stored offset and a setter that persists it
 */
export function useLabelOffset(): {
  offset: LabelSheetOffset;
  setOffset: (next: LabelSheetOffset) => void;
} {
  const [offset, setOffsetState] = useState<LabelSheetOffset>(ZERO_OFFSET);

  useEffect(() => {
    setOffsetState(readStoredOffset());
  }, []);

  const setOffset = useCallback((next: LabelSheetOffset) => {
    setOffsetState(next);

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage may be full or blocked. The offset still applies to THIS
      // session — failing to persist must not fail the print.
    }
  }, []);

  return { offset, setOffset };
}
