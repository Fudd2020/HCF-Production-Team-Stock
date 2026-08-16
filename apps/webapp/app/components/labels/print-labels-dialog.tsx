/**
 * "Print labels" — turns a bulk selection into a printed sheet of QR labels
 * (US-001), onto a part-used sheet (US-002), on a calibrated printer (US-003).
 *
 * Serves **both** the assets index and the kits index (US-001 AC8) — the only
 * difference is the `entity` prop, which the endpoint uses to decide which
 * table to resolve the selection against.
 *
 * ## Flow
 *
 * pick a stationery size → say where on the sheet to start → resolve the
 * selection server-side → render the sheet off-screen → wait for every QR image
 * to decode → open the print dialog.
 *
 * The wait is not optional. `react-to-print` clones the DOM into an iframe, and
 * a QR that has not decoded yet clones as a blank box — which prints as a blank
 * sticker onto real stationery and looks like a bug in the labels rather than a
 * race.
 *
 * ## Two print jobs, one print area
 *
 * The alignment test (US-003 AC1) shares this component's ref and print
 * plumbing but needs **no server call at all** — it is the grid itself, with no
 * item data. `PrintJob` discriminates the two so one `useEffect` drives both
 * and the two can never be in the print area at once.
 *
 * @see {@link file://./label-sheet.tsx} the printable output
 * @see {@link file://./../../routes/api+/labels.get-items-for-print.ts}
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { PrinterIcon } from "lucide-react";
import { useReactToPrint } from "react-to-print";

import { selectedBulkItemsAtom } from "~/atoms/list";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import When from "~/components/when/when";
import { useSearchParams } from "~/hooks/search-params";
import type { PrintLabelsLoaderData } from "~/routes/api+/labels.get-items-for-print";
import type { LabelSheetId } from "~/utils/label-sheets";
import {
  DEFAULT_LABEL_SHEET_ID,
  LABEL_SHEETS,
  MAX_LABELS_PER_PRINT,
  clampOffset,
  labelsPerSheet,
  nextStartPosition,
  normaliseStartPosition,
} from "~/utils/label-sheets";
import { isSelectingAllItems } from "~/utils/list";
import { LabelCalibrationFields } from "./label-calibration-fields";
import { LABEL_SHEET_PAGE_STYLE, LabelSheet } from "./label-sheet";
import { LabelSheetPicker } from "./label-sheet-picker";
import { LabelStartPositionField } from "./label-start-position-field";
import { useLabelOffset } from "./use-label-offset";

type PrintLabelsDialogProps = {
  /** Which index this dialog is mounted on — decides what the ids refer to. */
  entity: "asset" | "kit";
  isDialogOpen: boolean;
  onClose: () => void;
  className?: string;
};

/** What is currently loaded into the off-screen print area. */
type PrintJob =
  | { kind: "labels"; data: PrintLabelsLoaderData }
  /** The numbered outline sheet. Carries no data — it IS the grid (US-003 AC1). */
  | { kind: "alignment" };

/** The dialog's state machine. */
type PrintState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; job: PrintJob }
  | { status: "printed"; job: PrintJob }
  | { status: "error"; error: string };

// react-doctor:no-giant-component — the size picker, start position and
// calibration blocks are already extracted; what remains is the state machine
// and the print plumbing, which belong together.
export default function PrintLabelsDialog({
  entity,
  isDialogOpen,
  onClose,
  className,
}: PrintLabelsDialogProps) {
  const [sheetId, setSheetId] = useState<LabelSheetId>(DEFAULT_LABEL_SHEET_ID);
  const [state, setState] = useState<PrintState>({ status: "idle" });

  /**
   * Kept as raw TEXT, not a number.
   *
   * A numeric state would fight the user mid-type: clearing the field to retype
   * "12" momentarily reads as `NaN`, and normalising on every keystroke would
   * snap it back to 1 under their fingers. The value is normalised where it is
   * USED instead.
   */
  const [startPositionText, setStartPositionText] = useState("1");
  /** True when the value came from the previous print rather than the user. */
  const [carriedOver, setCarriedOver] = useState(false);

  const { offset, setOffset } = useLabelOffset();

  const [searchParams] = useSearchParams();
  const selectedItems = useAtomValue(selectedBulkItemsAtom);
  const allSelected = isSelectingAllItems(selectedItems);

  const sheetRef = useRef<HTMLDivElement>(null);

  /**
   * Supersession token and abort handle, mirroring the bulk QR download.
   *
   * The dialog stays mounted while the user re-filters behind it, and a request
   * can be dismissed while still in flight — so a late response must be able to
   * tell that it is stale rather than printing a sheet nobody asked for.
   */
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const spec = LABEL_SHEETS[sheetId];
  const perSheet = labelsPerSheet(spec);
  const startPosition = normaliseStartPosition(Number(startPositionText), spec);
  /** Re-clamped against the CURRENT spec — see `clampOffset`. */
  const safeOffset = clampOffset(offset, spec);

  const printSheet = useReactToPrint({
    contentRef: sheetRef,
    documentTitle: `labels-${spec.id}`,
    pageStyle: LABEL_SHEET_PAGE_STYLE,
    // See the file doc — a QR that has not decoded clones as a blank box.
    onBeforePrint: async () => {
      const container = sheetRef.current;
      if (!container) return;
      const { waitForImagesToLoad } = await import("~/utils/wait-for-images");
      await waitForImagesToLoad(container);
    },
    /**
     * `useReactToPrint` returns a plain `void` function — there is nothing to
     * await — so the transition out of `ready` has to come from this callback
     * rather than from the call site.
     */
    onAfterPrint: () => {
      setState((current) => {
        if (current.status !== "ready") return current;

        /**
         * US-002 AC5 — advance to where this print finished, so finishing a
         * sheet takes no arithmetic from the user.
         *
         * ⚠️ **Session only, and the STORAGE is the guarantee.** This lives in
         * React state, so it cannot survive a reload, which is exactly the
         * "never silently persist across days" the story demands — enforced
         * structurally rather than by a timestamp somebody has to maintain. It
         * is also not silent: the field shows the new value with a note saying
         * where it came from.
         *
         * The alignment test consumes no labels, so it must not advance
         * anything.
         */
        if (current.job.kind === "labels") {
          const printed = current.job.data.items.length;
          setStartPositionText(
            String(nextStartPosition(startPosition, printed, perSheet))
          );
          setCarriedOver(true);
        }

        return { status: "printed", job: current.job };
      });
    },
  });

  /**
   * Fires the print dialog once the sheet for THIS job is in the DOM.
   *
   * Printing cannot happen in the fetch handler: at that moment `sheetRef` is
   * still empty, because the items that populate it have not rendered yet.
   */
  useEffect(() => {
    if (state.status !== "ready") return;
    printSheet();
    // `printSheet` is recreated whenever the spec changes, which would re-fire
    // this for a sheet that has already printed; the `ready` guard above — and
    // `onAfterPrint` moving the state off `ready` — is what makes that safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const handleClose = useCallback(() => {
    // Supersede and abort anything in flight so a late resolution cannot open
    // a print dialog after this one has been dismissed.
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setState({ status: "idle" });
    onClose();
  }, [onClose]);

  /**
   * US-003 AC1 — no fetch, no selection, no server call. Straight to the print
   * area, which is why it works even with nothing selected.
   */
  function handleAlignmentTest() {
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    setState({ status: "ready", job: { kind: "alignment" } });
  }

  async function handlePrint() {
    if (selectedItems.length === 0) return;

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setState({ status: "loading" });

    // Carry the live filters so a select-all resolves to what the user can see
    // (AC7), and the explicit ids for a normal selection.
    const query = new URLSearchParams(searchParams);
    query.set("entity", entity);
    selectedItems.forEach((item) => query.append("ids", item.id));

    try {
      const response = await fetch(
        `/api/labels/get-items-for-print?${query.toString()}`,
        { signal: controller.signal }
      );
      const json = (await response.json()) as
        | PrintLabelsLoaderData
        | { error: { message: string } };

      if (requestId !== requestIdRef.current) return;

      if ("error" in json && json.error) {
        setState({ status: "error", error: json.error.message });
        return;
      }

      const data = json as PrintLabelsLoaderData;

      if (data.items.length === 0) {
        setState({
          status: "error",
          error:
            "None of the selected items have a QR code, so there is nothing to print.",
        });
        return;
      }

      setState({ status: "ready", job: { kind: "labels", data } });
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setState({
        status: "error",
        error: cause instanceof Error ? cause.message : "Something went wrong.",
      });
    }
  }

  const isBusy = state.status === "loading" || state.status === "ready";

  /**
   * Sheets needed, accounting for the slots skipped on the first one. Unknown
   * while "select all" is active, because the true count only exists
   * server-side.
   */
  const estimatedSheets = allSelected
    ? null
    : Math.ceil((selectedItems.length + startPosition - 1) / perSheet);

  const job =
    state.status === "printed" || state.status === "ready" ? state.job : null;
  const printedData = job?.kind === "labels" ? job.data : null;

  return (
    <>
      <DialogPortal>
        <Dialog
          open={isDialogOpen}
          onClose={handleClose}
          className={className}
          title={
            <div className="flex items-center justify-center rounded-full border-8 border-primary-50 bg-primary-100 p-2 text-primary-600">
              <PrinterIcon />
            </div>
          }
        >
          <div className="px-6 py-4">
            {isBusy ? (
              <div className="mb-6 flex flex-col items-center gap-4">
                <Spinner />
                <h3>Preparing labels…</h3>
              </div>
            ) : (
              <>
                <h4 className="mb-1">
                  Print labels for {allSelected ? "all" : selectedItems.length}{" "}
                  {entity}(s)
                </h4>
                <p className="mb-4 text-gray-600">
                  Choose the label stationery you have in the printer.
                </p>

                <LabelSheetPicker value={sheetId} onChange={setSheetId} />

                <LabelStartPositionField
                  value={startPositionText}
                  onChange={(next) => {
                    setStartPositionText(next);
                    // Once they type, it is theirs, not a carry-over.
                    setCarriedOver(false);
                  }}
                  spec={spec}
                  carriedOver={carriedOver}
                />

                <LabelCalibrationFields
                  offset={safeOffset}
                  onChange={setOffset}
                  onPrintAlignmentTest={handleAlignmentTest}
                  spec={spec}
                />

                {/*
                  AC3. Browser scaling cannot be disabled from here, so the
                  requirement is stated before the print dialog opens — and the
                  sheet itself prints a 100 mm rule so a wrong setting is
                  measurable rather than merely suspected.
                */}
                <div className="mb-4 rounded-md border border-warning-200 bg-warning-25 p-3 text-sm text-gray-700">
                  <p className="font-medium">Set the scale to 100%</p>
                  <p>
                    In the print dialog, turn off &ldquo;Fit to page&rdquo; and
                    set margins to none. Each sheet prints a 100&nbsp;mm rule at
                    the bottom — measure it before printing onto stationery.
                  </p>
                </div>

                <When truthy={!allSelected && estimatedSheets !== null}>
                  <p className="mb-4 text-sm text-gray-500">
                    {selectedItems.length} label(s) from position{" "}
                    {startPosition} — {estimatedSheets} sheet(s) at {perSheet}{" "}
                    per sheet.
                  </p>
                </When>

                <When
                  truthy={
                    !allSelected && selectedItems.length > MAX_LABELS_PER_PRINT
                  }
                >
                  <p className="mb-4 text-sm text-error-500">
                    Printing is limited to {MAX_LABELS_PER_PRINT} labels at a
                    time. Narrow the selection and print in batches.
                  </p>
                </When>

                {state.status === "printed" ? (
                  <div className="mb-4 rounded-md border border-gray-200 bg-gray-25 p-3 text-sm text-gray-700">
                    <p className="font-medium text-success-600">
                      {state.job.kind === "alignment"
                        ? "Alignment test sent to the printer."
                        : "Sent to the printer."}
                    </p>
                    <p>
                      {state.job.kind === "alignment"
                        ? "Hold it against a sheet of your labels. If it is off, nudge the grid above and test again."
                        : "Check the 100 mm rule on the printed page before sticking anything down."}
                    </p>
                    <When truthy={printedData?.skippedCount ? true : false}>
                      <p className="mt-2 text-warning-600">
                        {printedData?.skippedCount} item(s) had no QR code and
                        were left out.
                      </p>
                    </When>
                  </div>
                ) : null}

                {state.status === "error" ? (
                  <p className="mb-4 text-sm text-error-500" role="alert">
                    {state.error}
                  </p>
                ) : null}

                <div className="flex w-full items-center justify-center gap-4">
                  <Button
                    type="button"
                    className="flex-1"
                    variant="secondary"
                    onClick={handleClose}
                  >
                    Close
                  </Button>
                  <Button
                    type="button"
                    className="flex-1"
                    onClick={() => void handlePrint()}
                    disabled={
                      isBusy ||
                      selectedItems.length === 0 ||
                      (!allSelected &&
                        selectedItems.length > MAX_LABELS_PER_PRINT)
                    }
                  >
                    {state.status === "printed" ? "Print again" : "Print"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      </DialogPortal>

      {/*
        The printable sheet. Positioned off-screen rather than `display: none`,
        because a hidden subtree does not load its images — and an unloaded QR
        prints blank.
      */}
      {job ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-10000px",
            top: 0,
            width: "210mm",
          }}
        >
          <LabelSheet
            ref={sheetRef}
            items={printedData?.items ?? []}
            spec={spec}
            qrIdDisplayPreference={printedData?.qrIdDisplayPreference}
            startPosition={startPosition}
            offset={safeOffset}
            alignmentTest={job.kind === "alignment"}
          />
        </div>
      ) : null}
    </>
  );
}
