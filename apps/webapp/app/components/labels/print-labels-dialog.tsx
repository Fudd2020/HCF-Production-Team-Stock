/**
 * "Print labels" — turns a bulk selection into a printed sheet of QR labels
 * (US-001).
 *
 * Serves **both** the assets index and the kits index (AC8) — the only
 * difference is the `entity` prop, which the endpoint uses to decide which
 * table to resolve the selection against.
 *
 * ## Flow
 *
 * pick a stationery size → resolve the selection server-side → render the
 * sheet off-screen → wait for every QR image to decode → open the print dialog.
 *
 * The wait is not optional. `react-to-print` clones the DOM into an iframe, and
 * a QR that has not decoded yet clones as a blank box — which prints as a blank
 * sticker onto real stationery and looks like a bug in the labels rather than a
 * race.
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
  LABEL_SHEET_OPTIONS,
  MAX_LABELS_PER_PRINT,
  labelsPerSheet,
} from "~/utils/label-sheets";
import { isSelectingAllItems } from "~/utils/list";
import { tw } from "~/utils/tw";
import { LABEL_SHEET_PAGE_STYLE, LabelSheet } from "./label-sheet";

type PrintLabelsDialogProps = {
  /** Which index this dialog is mounted on — decides what the ids refer to. */
  entity: "asset" | "kit";
  isDialogOpen: boolean;
  onClose: () => void;
  className?: string;
};

/**
 * The dialog's state machine.
 *
 * `ready` holds the resolved payload; rendering it is what puts the sheet in
 * the DOM, which is the precondition for printing it.
 */
type PrintState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: PrintLabelsLoaderData }
  | { status: "printed"; data: PrintLabelsLoaderData }
  | { status: "error"; error: string };

/**
 * Launcher-driven dialog for printing a sheet of labels.
 *
 * @param props - See {@link PrintLabelsDialogProps}
 * @returns The portalled dialog plus the off-screen printable sheet
 */
// react-doctor:no-giant-component — deferred for follow-up refactor; US-002
// (start position) and US-003 (alignment offsets) both add controls here, so
// the split is worth doing once, after their shape is known.
export default function PrintLabelsDialog({
  entity,
  isDialogOpen,
  onClose,
  className,
}: PrintLabelsDialogProps) {
  const [sheetId, setSheetId] = useState<LabelSheetId>(DEFAULT_LABEL_SHEET_ID);
  const [state, setState] = useState<PrintState>({ status: "idle" });

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
      setState((current) =>
        current.status === "ready"
          ? { status: "printed", data: current.data }
          : current
      );
    },
  });

  /**
   * Fires the print dialog once the sheet for THIS payload is in the DOM.
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

      setState({ status: "ready", data });
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setState({
        status: "error",
        error: cause instanceof Error ? cause.message : "Something went wrong.",
      });
    }
  }

  const isBusy = state.status === "loading" || state.status === "ready";
  const perSheet = labelsPerSheet(spec);

  /**
   * Sheet count for the label under the button. Unknown while "select all" is
   * active, because the true count only exists server-side.
   */
  const estimatedSheets = allSelected
    ? null
    : Math.ceil(selectedItems.length / perSheet);

  const printedData =
    state.status === "printed" || state.status === "ready" ? state.data : null;

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
            {state.status === "loading" || state.status === "ready" ? (
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

                <fieldset className="mb-4">
                  <legend className="sr-only">Label size</legend>
                  {/*
                    Both text spans below are DIRECT children of the label, not
                    wrapped in a layout element — `jsx-a11y/label-has-associated-
                    control` only looks two levels deep, so a wrapper makes the
                    label read as having no accessible text. The two-column grid
                    does the stacking instead.
                  */}
                  <div className="flex flex-col gap-2">
                    {LABEL_SHEET_OPTIONS.map((option) => (
                      <label
                        key={option.id}
                        className={tw(
                          "grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 rounded border p-3",
                          option.id === sheetId
                            ? "border-primary-500 bg-primary-25"
                            : "border-gray-300"
                        )}
                      >
                        <input
                          type="radio"
                          name="label-sheet"
                          value={option.id}
                          checked={option.id === sheetId}
                          onChange={() => setSheetId(option.id)}
                          className="row-span-2 mt-1"
                        />
                        <span className="text-sm font-medium text-gray-900">
                          {option.name}
                        </span>
                        <span className="text-xs text-gray-500">
                          {option.description}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

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
                    {selectedItems.length} label(s) — {estimatedSheets} sheet(s)
                    at {perSheet} per sheet.
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
                  <div className="mb-4 rounded border border-gray-200 bg-gray-25 p-3 text-sm text-gray-700">
                    <p className="font-medium text-success-600">
                      Sent to the printer.
                    </p>
                    <p>
                      Check the 100&nbsp;mm rule on the printed page before
                      sticking anything down.
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
      {printedData ? (
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
            items={printedData.items}
            spec={spec}
            qrIdDisplayPreference={printedData.qrIdDisplayPreference}
          />
        </div>
      ) : null}
    </>
  );
}
