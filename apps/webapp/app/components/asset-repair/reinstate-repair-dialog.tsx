/**
 * Reinstate — bring a written-off item back into service (US-012).
 *
 * ## Why this is ONE AlertDialog and not a typed confirmation
 *
 * `DECISIONS.md` #103, and it is worth stating because the sibling write-off
 * dialog does the opposite. Writing off demands a `confirm="WRITE_OFF"`
 * literal; this asks once and acts.
 *
 * The asymmetry is deliberate. **Reinstating is reversible and destroys
 * nothing** — the repair record is append-only (#47), so the write-off stays on
 * the row for ever and a mistake is undone by writing the item off again.
 * Type-to-confirm is this product's gate for *irreversible destruction*;
 * spending it here would devalue it exactly where it matters.
 *
 * The weight comes from **information, not friction**: you cannot reach the
 * button without the panel above it telling you what the fault was and who
 * scrapped the item, the action is `OWNER`/`ADMIN` only (#64), and US-012 AC4
 * puts a name and a timestamp against every use.
 *
 * ⚠️ **The copy must not imply the item is fixed.** Reinstating returns it to
 * the pool; whether it actually works is a separate question, and US-012 AC5
 * expects a NEW fault report if it is still broken. Saying "repaired" here
 * would be the same lie the history renderer avoids by branching on `outcome`
 * before `closedAt`.
 *
 * Posts with `useFetcher` to the shared update route, which returns DATA rather
 * than redirecting (`DECISIONS.md` #182) so a lead sweeping `/repairs` is not
 * yanked out of the list. The success toast comes from the server, and the
 * fetcher's revalidation is what clears the written-off panel.
 *
 * @see {@link file://./../../routes/_layout+/assets.$assetId.repairs.$repairId.update.tsx}
 * @see {@link file://./manage-repair-dialog.tsx} the sibling that writes one off
 */

import { useFetcher } from "react-router";

import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { useDisabled } from "~/hooks/use-disabled";
import type { DataOrErrorResponse } from "~/utils/http.server";

/** What the update route resolves to. Declared locally so no server module leaks. */
type ReinstateResponse = DataOrErrorResponse<{ success: true }>;

type ReinstateRepairDialogProps = {
  /** Asset the repair belongs to — half of the POST URL. */
  assetId: string;
  /** The WRITTEN-OFF repair being reversed. */
  repairId: string;
  /** Rendered in the dialog title. */
  assetTitle: string;
  /** Who wrote it off, for the "what you are overturning" line. `null` if unknown. */
  writtenOffByName?: string | null;
  /** When it was written off. `null` if the row predates the attribution columns. */
  writtenOffAt?: Date | string | null;
};

/**
 * Launcher button plus the reinstate confirmation.
 *
 * @param props - See {@link ReinstateRepairDialogProps}
 * @returns The trigger and its alert dialog
 */
export function ReinstateRepairDialog({
  assetId,
  repairId,
  assetTitle,
  writtenOffByName,
  writtenOffAt,
}: ReinstateRepairDialogProps) {
  const fetcher = useFetcher<ReinstateResponse>();
  const disabled = useDisabled(fetcher);

  const submitError = fetcher.data?.error ?? null;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          Reinstate
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reinstate {assetTitle}?</AlertDialogTitle>
          <AlertDialogDescription>
            This puts the item back in the bookable pool. It does not mark it as
            repaired — if it is still faulty, report a new fault instead.
          </AlertDialogDescription>

          {/*
            What you are overturning. This is the "weight comes from
            information" half of #103: the decision being reversed is named,
            with who took it and when, so the confirmation carries meaning
            rather than merely costing a second click.
          */}
          {writtenOffByName ? (
            <div className="rounded-md border border-gray-200 bg-gray-25 p-3 text-sm text-gray-700">
              Written off by <strong>{writtenOffByName}</strong>
              {writtenOffAt ? (
                <>
                  {" "}
                  on <DateS date={writtenOffAt} />
                </>
              ) : null}
              . That stays on the record — reinstating adds to the history, it
              does not erase it.
            </div>
          ) : null}

          {submitError ? (
            <div
              className="rounded-md border border-error-200 bg-error-25 p-3 text-sm text-error-600"
              role="alert"
            >
              {submitError.message}
            </div>
          ) : null}
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="secondary" disabled={disabled}>
              Cancel
            </Button>
          </AlertDialogCancel>

          <fetcher.Form
            method="post"
            action={`/assets/${assetId}/repairs/${repairId}/update`}
          >
            <input type="hidden" name="intent" value="reinstate" />
            <Button type="submit" variant="primary" disabled={disabled}>
              {disabled ? "Reinstating…" : "Reinstate"}
            </Button>
          </fetcher.Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
