/**
 * Mark as repaired — US-005's dialog (`design.md` §8).
 *
 * Closing a repair is one optional field and a confirmation, so it is a dialog
 * rather than a page: it is launched from two surfaces (the asset's
 * out-of-action panel, §6.3, and later the `/repairs` row action, §9) and a
 * page would lose the context of both.
 *
 * **It posts with `useFetcher` to `/assets/:assetId/repairs/:repairId/close`.**
 * That route's action deliberately returns DATA rather than redirecting
 * (`DECISIONS.md` #182): a redirect would yank a lead out of a `/repairs` sweep
 * after every single row. The success toast ("Back in service") is sent by the
 * server via `sendNotification`, and the fetcher's automatic revalidation is
 * what clears the out-of-action panel (AC3) and drops the row from `/repairs`
 * (AC4) — this component does neither by hand.
 *
 * ⚠️ **Server errors are read off `fetcher.data`, not `useActionData`.** A
 * fetcher submission never populates `useActionData`, so the mandatory
 * server-side validation fallback (`CLAUDE.md` § Form Validation Pattern) has
 * to source its error from the fetcher. Wiring it to `useActionData` here would
 * compile, pass tests, and silently show the user nothing.
 *
 * @see {@link file://./../../routes/_layout+/assets.$assetId.repairs.$repairId.close.tsx}
 * @see {@link file://./../../modules/asset-repair/schema.ts}
 * @see {@link file://./asset-repair-panels.tsx}
 */

import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useZorm } from "react-zorm";

import Input from "~/components/forms/input";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import {
  closeRepairSchema,
  RESOLUTION_NOTE_MAX_LENGTH,
} from "~/modules/asset-repair/schema";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { tw } from "~/utils/tw";
import { RepairNoticePanel } from "./repair-notice-panel";

/**
 * What `POST /assets/:assetId/repairs/:repairId/close` resolves to.
 *
 * Mirrors the as-built contract in `progress.md` §3.3 — `payload()` on success,
 * `error()` on every refusal. Declared locally rather than imported from the
 * route so this component never reaches into a module that also exports server
 * code (`.claude/rules/no-server-module-in-route-client-exports.md`); the type
 * import below is erased at compile time and is safe.
 */
type CloseRepairResponse = DataOrErrorResponse<{
  success: true;
  repairId: string;
  assetId: string;
  assetTitle: string;
}>;

/**
 * Roughly the most characters that fit in the clamped four lines of fault text
 * at this dialog's width. Above it, the `Show more` toggle is offered.
 */
const CLAMPED_FAULT_MIN_LENGTH = 240;

/** Details of the fault being closed. Every field is optional — see the note. */
type ReportedFaultSummary = {
  /** The original fault text, rendered verbatim (clamped, with `Show more`). */
  faultDescription: string;
  /** Who reported it. `null` for backfilled rows with no known reporter. */
  reporterName?: string | null;
  /** When it was reported. Rendered through `DateS`, never `toLocaleDateString`. */
  reportedAt?: string | Date | null;
  /** Whole days the item has been out of action, if the surface computed it. */
  daysOutOfAction?: number | null;
};

type MarkAsRepairedDialogProps = {
  /** Asset the repair belongs to. Half of the POST URL, and org-checked server-side. */
  assetId: string;
  /** The OPEN repair to close. The other half of the POST URL. */
  repairId: string;
  /** Rendered in the subtitle and the consequence line. */
  assetTitle: string;
  /**
   * The fault being closed, when the launching surface has it.
   *
   * ⚠️ **No caller supplies this today.** `design.md` §8 shows a "Reported
   * fault" block above the note field, but the asset-detail layout loader
   * selects `repairs: { select: { id }, take: 1 }` only — the enriched repair
   * payload (description, reporter, dates) is US-004's contract addition
   * (`progress.md` §3.3, `design.md` §11 item 8) and altering a loader's shape
   * is not this story's to do. The block renders the moment a surface passes
   * it; until then the dialog degrades to title + note + consequence.
   */
  reportedFault?: ReportedFaultSummary;
  /** Label on the launcher button. Defaults to the design's copy. */
  triggerLabel?: string;
  /** Extra classes for the launcher button (row actions want a tighter one). */
  triggerClassName?: string;
};

/**
 * Launcher button plus the "Mark as repaired" confirmation dialog.
 *
 * The component owns its own `open` state and renders its own trigger so both
 * launch surfaces get an identical, keyboard-reachable affordance rather than a
 * click handler bolted onto arbitrary children.
 *
 * ⚠️ **Render this only for roles that hold `assetRepair:update`.** That gating
 * is cosmetic — `requirePermission` in the route action is the enforcement
 * (US-005 AC9) — but a button that always 403s is worse than no button.
 *
 * @param props - See {@link MarkAsRepairedDialogProps}
 * @returns The trigger button and, while open, the portalled dialog
 */
export function MarkAsRepairedDialog({
  assetId,
  repairId,
  assetTitle,
  reportedFault,
  triggerLabel = "Mark as repaired",
  triggerClassName,
}: MarkAsRepairedDialogProps) {
  const [open, setOpen] = useState(false);
  const [faultExpanded, setFaultExpanded] = useState(false);

  const fetcher = useFetcher<CloseRepairResponse>();
  const disabled = useDisabled(fetcher);
  const zo = useZorm("MarkAsRepaired", closeRepairSchema);

  const noteRef = useAutoFocus<HTMLTextAreaElement>({ when: open });

  const helpId = useId();
  const errorId = useId();
  const submitErrorId = useId();
  const faultLabelId = useId();

  /**
   * Server-side validation fallback (`CLAUDE.md` § Form Validation Pattern).
   * Sourced from `fetcher.data` because a fetcher submission never reaches
   * `useActionData` — see the file doc.
   */
  const validationErrors = getValidationErrors<typeof closeRepairSchema>(
    fetcher.data?.error
  );
  const noteError =
    validationErrors?.resolutionNote?.message ||
    zo.errors.resolutionNote()?.message;

  /**
   * Everything the action refuses with that is NOT field-level: the 400 for an
   * already-closed repair (AC6), the non-disclosing 404 (AC7), and — once
   * US-008 ships `outcome` — the written-off 400. Rendered from the server's
   * own message so the words the user reads are the words the contract fixes
   * (`REPAIR_ALREADY_CLOSED_MESSAGE` / `REPAIR_NOT_FOUND_MESSAGE`).
   */
  const submitError =
    fetcher.data?.error && !validationErrors ? fetcher.data.error : null;

  /**
   * Every one of those refusals is terminal: the repair is already closed, or
   * it is not ours to close. Re-submitting the same body cannot change any of
   * them, so the confirm button locks and the copy tells the user to close and
   * refresh (`design.md` §8, "Already closed (400)").
   *
   * why: this cannot discriminate WHICH refusal it was. The literal messages
   * live in `modules/asset-repair/service.server.ts`, a server module a client
   * component may not import, and all of the current refusals are terminal — so
   * the treatment is uniform rather than message-matched.
   */
  const isTerminalError = submitError !== null;

  /**
   * One-shot latch so the dialog closes once per successful submission.
   *
   * `fetcher.data` persists after the request settles, so an unlatched effect
   * would re-close the dialog on any later re-render — and, if the user
   * reopened it, close it again instantly against a stale success. Re-armed at
   * the START of each submission rather than on open, which is the only moment
   * a NEW success can begin.
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
    setOpen(false);
  }, [fetcher.state, fetcher.data]);

  /**
   * `aria-describedby` takes a space-separated ID list. Built by hand — `tw()`
   * is a Tailwind class merger and would be free to rewrite these tokens.
   */
  const noteDescribedBy = [helpId, noteError ? errorId : null]
    .filter(Boolean)
    .join(" ");

  function handleClose() {
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        className={triggerClassName}
      >
        {triggerLabel}
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
                Mark as repaired
              </h3>
              <p className="truncate text-gray-600">{assetTitle}</p>
            </div>
          }
        >
          <fetcher.Form
            ref={zo.ref}
            method="post"
            action={`/assets/${assetId}/repairs/${repairId}/close`}
          >
            <div className="px-6 py-4">
              {reportedFault ? (
                <div className="mb-5">
                  <h4
                    id={faultLabelId}
                    className="text-sm font-semibold text-gray-900"
                  >
                    Reported fault
                  </h4>
                  {/*
                    A description list, not prose: a screen reader should read
                    "Reported by — Sam Whitfield" as a pair rather than running
                    the attribution into the fault text (`design.md` §8).
                  */}
                  <dl className="mt-1" aria-labelledby={faultLabelId}>
                    <dt className="sr-only">Fault</dt>
                    <dd
                      className={tw(
                        "text-sm text-gray-700",
                        faultExpanded ? undefined : "line-clamp-4"
                      )}
                    >
                      {reportedFault.faultDescription}
                    </dd>

                    {reportedFault.reporterName ? (
                      <>
                        <dt className="sr-only">Reported by</dt>
                        <dd className="mt-1 text-xs text-gray-600">
                          {reportedFault.reporterName}
                        </dd>
                      </>
                    ) : null}

                    {reportedFault.reportedAt ? (
                      <>
                        <dt className="sr-only">Reported on</dt>
                        <dd className="text-xs text-gray-600">
                          <DateS date={reportedFault.reportedAt} />
                        </dd>
                      </>
                    ) : null}

                    {typeof reportedFault.daysOutOfAction === "number" ? (
                      <>
                        <dt className="sr-only">Out of action</dt>
                        <dd className="text-xs text-gray-600">
                          Out of action {reportedFault.daysOutOfAction}{" "}
                          {reportedFault.daysOutOfAction === 1 ? "day" : "days"}
                        </dd>
                      </>
                    ) : null}
                  </dl>

                  {/*
                    A visible, focusable toggle rather than a tooltip: the fault
                    text is the whole reason the lead is here and it has to be
                    reachable on touch (`design.md` §6.7, "Long fault text").

                    why the length guard: `line-clamp-4` only truncates text
                    that overflows four lines, and there is no way to know that
                    without measuring. Offering "Show more" on a six-word fault
                    would be a control that visibly does nothing, so the toggle
                    is gated on a character count that cannot fit in four lines
                    at this dialog's width. Erring long is the safe direction —
                    a missing toggle on a borderline fault still shows four
                    lines of it.
                  */}
                  {reportedFault.faultDescription.length >
                  CLAMPED_FAULT_MIN_LENGTH ? (
                    <Button
                      type="button"
                      variant="link"
                      className="mt-1 text-xs"
                      onClick={() => setFaultExpanded((expanded) => !expanded)}
                    >
                      {faultExpanded ? "Show less" : "Show more"}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <Input
                ref={noteRef}
                label="What was done? (optional)"
                inputType="textarea"
                name={zo.fields.resolutionNote()}
                rows={4}
                /**
                 * `Input`'s textarea defaults to `maxLength={250}`, which would
                 * silently truncate against a 1,000-character schema with no
                 * message at all. Always pass it explicitly.
                 */
                maxLength={RESOLUTION_NOTE_MAX_LENGTH}
                placeholder="e.g. Re-terminated the male XLR and tested it"
                error={noteError}
                /** Rendered below with `role="alert"` and wired via aria-describedby. */
                hideErrorText
                aria-invalid={noteError ? true : undefined}
                aria-describedby={noteDescribedBy}
                disabled={disabled}
              />

              {noteError ? (
                <p
                  id={errorId}
                  role="alert"
                  className="mt-1 text-sm text-error-600"
                >
                  {noteError}
                </p>
              ) : null}

              <p id={helpId} className="mt-2 text-sm text-gray-500">
                Kept with the fault so the next person can see how it was fixed.
              </p>

              {submitError ? (
                <RepairNoticePanel
                  tone="danger"
                  title={
                    submitError.title || "We couldn't mark that as repaired"
                  }
                  className="mt-4"
                >
                  {/*
                    `role="alert"` on the message, not on the panel: the panel is
                    a landmark that can be present on load, this text appears in
                    response to the user's own action and must be announced.
                  */}
                  <p id={submitErrorId} role="alert">
                    {submitError.message}
                  </p>
                </RepairNoticePanel>
              ) : null}
            </div>

            <div className="border-t px-6 py-4">
              <p className="mb-3 text-sm text-gray-600">
                {assetTitle} goes straight back into the pool and can be booked
                again.
              </p>
              <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
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
                  /**
                   * `primary`, never `danger` — returning a repaired item to
                   * service is a good outcome, and `danger` is reserved for
                   * destructive actions (`design.md` §8, `button.tsx:168-176`).
                   */
                  variant="primary"
                  width="full"
                  className="md:w-auto"
                  disabled={disabled || isTerminalError}
                  aria-describedby={submitError ? submitErrorId : undefined}
                >
                  {disabled ? "Saving…" : "Mark as repaired"}
                </Button>
              </div>
            </div>
          </fetcher.Form>
        </Dialog>
      </DialogPortal>
    </>
  );
}
