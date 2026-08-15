/**
 * Manage a repair — move it between stages, record a diagnosis, or write the
 * item off (US-008 AC1, AC2, AC4).
 *
 * A dialog rather than a page, for the same reason as the close dialog: it is
 * launched from the Repairs tab and from `/repairs`, and a page would lose the
 * context of both. It posts with `useFetcher` to
 * `/assets/:assetId/repairs/:repairId/update`, which returns DATA rather than
 * redirecting (`DECISIONS.md` #182).
 *
 * ⚠️ **Render this only for roles holding `assetRepair:update`** — `OWNER` and
 * `ADMIN` (US-008 AC9). That gating is cosmetic; the route action is the
 * enforcement. `BASE` can report a fault and read the history but never moves a
 * repair along.
 *
 * ⚠️ **Server errors are read off `fetcher.data`, not `useActionData`.** A
 * fetcher submission never populates `useActionData`, so wiring the mandatory
 * validation fallback there would compile, pass tests, and show the user
 * nothing.
 *
 * @see {@link file://./../../routes/_layout+/assets.$assetId.repairs.$repairId.update.tsx}
 * @see {@link file://./mark-as-repaired-dialog.tsx} the sibling that closes one
 */

import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Input from "~/components/forms/input";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { DIAGNOSIS_MAX_LENGTH } from "~/modules/asset-repair/schema";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { tw } from "~/utils/tw";
import { RepairNoticePanel } from "./repair-notice-panel";

/** The open stages a lead can move between, in the order they usually happen. */
const STAGES = [
  { value: "REPORTED", label: "Reported" },
  { value: "DIAGNOSED", label: "Diagnosed" },
  { value: "IN_REPAIR", label: "In repair" },
] as const;

type StageValue = (typeof STAGES)[number]["value"];

/** What the update route resolves to. Declared locally so no server module leaks. */
type UpdateRepairResponse = DataOrErrorResponse<{ success: true }>;

type ManageRepairDialogProps = {
  /** Asset the repair belongs to — half of the POST URL. */
  assetId: string;
  /** The OPEN repair being managed. */
  repairId: string;
  /** Rendered in the dialog subtitle. */
  assetTitle: string;
  /** Where the repair is now, so the control opens on the truth. */
  currentStatus: StageValue;
  /** Any diagnosis already recorded, so an edit does not start from blank. */
  currentDiagnosis?: string | null;
};

/**
 * Launcher button plus the manage-repair dialog.
 *
 * @param props - See {@link ManageRepairDialogProps}
 * @returns The trigger and, while open, the portalled dialog
 */
export function ManageRepairDialog({
  assetId,
  repairId,
  assetTitle,
  currentStatus,
  currentDiagnosis,
}: ManageRepairDialogProps) {
  const [open, setOpen] = useState(false);
  /**
   * The write-off confirmation is a SEPARATE step inside the dialog, not a
   * third button on the row. Writing off is terminal and permanent — the only
   * route back is US-012 — so it must not be one mis-click away.
   */
  const [confirmingWriteOff, setConfirmingWriteOff] = useState(false);

  const fetcher = useFetcher<UpdateRepairResponse>();
  const disabled = useDisabled(fetcher);

  const diagnosisId = useId();
  const errorId = useId();

  const action = `/assets/${assetId}/repairs/${repairId}/update`;

  /** Server-side fallback, sourced from the fetcher — see the file doc. */
  const submitError = fetcher.data?.error ?? null;

  /**
   * One-shot latch so the dialog closes once per successful submission.
   * `fetcher.data` persists after the request settles, so an unlatched effect
   * would re-close it on any later re-render — and again instantly if the user
   * reopened it, against a stale success. Re-armed at the START of each
   * submission, the only moment a NEW success can begin.
   */
  const successHandledRef = useRef(false);

  useEffect(() => {
    if (fetcher.state === "submitting") {
      successHandledRef.current = false;
      return;
    }

    if (fetcher.state !== "idle" || successHandledRef.current) {
      return;
    }

    // `error: null` is the discriminant `payload()` puts on every success.
    if (!fetcher.data || fetcher.data.error !== null) {
      return;
    }

    successHandledRef.current = true;
    setConfirmingWriteOff(false);
    setOpen(false);
  }, [fetcher.state, fetcher.data]);

  function handleClose() {
    setConfirmingWriteOff(false);
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Manage repair
      </Button>

      <DialogPortal>
        <Dialog
          open={open}
          onClose={handleClose}
          className="md:w-[520px]"
          headerClassName="border-b"
          title={
            <div className="-mb-3 w-full pb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Manage repair
              </h3>
              <p className="truncate text-gray-600">{assetTitle}</p>
            </div>
          }
        >
          {confirmingWriteOff ? (
            /* ── Write off: a deliberate second step ─────────────────────── */
            <fetcher.Form method="post" action={action}>
              <input type="hidden" name="intent" value="write-off" />
              {/*
                The literal the schema demands. Its presence is what proves the
                user passed through this screen rather than mis-clicking a
                dropdown on the previous one.
              */}
              <input type="hidden" name="confirm" value="WRITE_OFF" />

              <div className="px-6 py-4">
                <RepairNoticePanel
                  tone="danger"
                  title="This can't be undone from here"
                >
                  <p>
                    {assetTitle} will be recorded as beyond repair and stays out
                    of the bookable pool permanently. Anyone with it on a future
                    booking will be emailed so they can find a replacement.
                  </p>
                </RepairNoticePanel>

                <Input
                  label="Why? (optional)"
                  inputType="textarea"
                  name="reason"
                  rows={3}
                  maxLength={1000}
                  placeholder="e.g. Connector housing cracked, not economic to repair"
                  className="mt-4"
                  disabled={disabled}
                />

                {submitError ? (
                  <RepairNoticePanel
                    tone="danger"
                    title={submitError.title || "Couldn't write this off"}
                    className="mt-4"
                  >
                    <p id={errorId} role="alert">
                      {submitError.message}
                    </p>
                  </RepairNoticePanel>
                ) : null}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t px-6 py-4 md:flex-row md:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  width="full"
                  className="md:w-auto"
                  disabled={disabled}
                  onClick={() => setConfirmingWriteOff(false)}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  width="full"
                  className="md:w-auto"
                  disabled={disabled}
                >
                  {disabled ? "Writing off…" : "Write it off"}
                </Button>
              </div>
            </fetcher.Form>
          ) : (
            /* ── Move stage / record a diagnosis ─────────────────────────── */
            <fetcher.Form method="post" action={action}>
              <input type="hidden" name="intent" value="transition" />

              <div className="px-6 py-4">
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-gray-700">
                    Where is this repair now?
                  </legend>
                  <div className="flex flex-col gap-2">
                    {STAGES.map((stage) => (
                      <label
                        key={stage.value}
                        className={tw(
                          "flex cursor-pointer items-center gap-3 rounded border p-3",
                          stage.value === currentStatus
                            ? "border-primary-500 bg-primary-25"
                            : "border-gray-300"
                        )}
                      >
                        <input
                          type="radio"
                          name="toStatus"
                          value={stage.value}
                          defaultChecked={stage.value === currentStatus}
                          disabled={disabled}
                        />
                        <span className="text-sm text-gray-900">
                          {stage.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {/*
                  Moving BACKWARDS is allowed on purpose (AC2a) — a bench fix
                  that fails puts the item back on the bench, and refusing that
                  only teaches people to work around the system.
                */}

                <Input
                  id={diagnosisId}
                  label="What did you find? (optional)"
                  inputType="textarea"
                  name="diagnosis"
                  rows={4}
                  maxLength={DIAGNOSIS_MAX_LENGTH}
                  defaultValue={currentDiagnosis ?? ""}
                  placeholder="e.g. Cold joint, male XLR pin 2"
                  className="mt-4"
                  disabled={disabled}
                />
                <p className="mt-2 text-sm text-gray-500">
                  Kept separately from the reported fault, so the reporter's own
                  words stay intact.
                </p>

                {submitError ? (
                  <RepairNoticePanel
                    tone="danger"
                    title={submitError.title || "Couldn't update this repair"}
                    className="mt-4"
                  >
                    <p role="alert">{submitError.message}</p>
                  </RepairNoticePanel>
                ) : null}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t px-6 py-4 md:flex-row md:justify-between">
                {/*
                  Write-off lives here as a low-emphasis link rather than a
                  primary action: it is the rarest outcome and the only
                  irreversible one.
                */}
                <Button
                  type="button"
                  variant="link"
                  className="text-error-600"
                  disabled={disabled}
                  onClick={() => setConfirmingWriteOff(true)}
                >
                  Write this item off
                </Button>

                <div className="flex flex-col-reverse gap-2 md:flex-row">
                  <Button
                    type="button"
                    variant="secondary"
                    width="full"
                    className="md:w-auto"
                    disabled={disabled}
                    onClick={handleClose}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    width="full"
                    className="md:w-auto"
                    disabled={disabled}
                  >
                    {disabled ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </fetcher.Form>
          )}
        </Dialog>
      </DialogPortal>
    </>
  );
}
