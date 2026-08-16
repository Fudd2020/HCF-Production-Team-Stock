/**
 * Asset detail — equipment-repair panels (`design.md` §6.3, §6.4).
 *
 * Two panels rendered at the very top of the asset Overview, above the
 * property card:
 *
 * - {@link FaultReportedPanel} — the post-report confirmation. It exists
 *   because a toast does not solve the `SELF_SERVICE` dead end: after
 *   reporting, the asset becomes unbookable and drops out of that user's
 *   force-filtered index, so a message that vanishes in four seconds on a
 *   phone in a dark church answers nothing (`design.md` D4, US-007 AC7).
 * - {@link OutOfActionPanel} — the permanent statement that the item cannot
 *   be booked. Every role that can load the asset page sees it, including
 *   `SELF_SERVICE`; it discloses nothing they could not already read off the
 *   status badge US-001 AC3 requires everywhere.
 *
 * @see {@link file://./repair-notice-panel.tsx}
 * @see {@link file://./../../routes/_layout+/assets.$assetId.overview.tsx}
 */

import { useState } from "react";
import { useSearchParams } from "~/hooks/search-params";
import { useAssetRepairSummary } from "~/hooks/use-asset-repair-state";
import { MarkAsRepairedDialog } from "./mark-as-repaired-dialog";
import { ReinstateRepairDialog } from "./reinstate-repair-dialog";
import { RepairNoticePanel } from "./repair-notice-panel";
import { Button } from "../shared/button";
import { DateS } from "../shared/date";

/**
 * Search param the report-fault action redirects with. Its only job is to
 * trigger {@link FaultReportedPanel} once.
 */
const FAULT_REPORTED_PARAM = "faultReported";

/**
 * Persistent confirmation shown immediately after a fault is reported.
 *
 * Renders only while `?faultReported=1` is present. Dismissing both hides it
 * locally and strips the param so a refresh does not resurrect it.
 *
 * **The `replace: true` and the local latch are not optional.** Stripping a
 * param re-runs the loader; without a local "dismissed" flag the panel would
 * reappear for the frame before the navigation settles, and without `replace`
 * every dismiss would push a history entry the back button walks into. The
 * same param-strip shape caused a production revalidation loop in
 * `set-or-edit-reminder-dialog.tsx` — that latch comment is worth reading
 * before editing this.
 *
 * @returns The success panel, or `null`
 */
export function FaultReportedPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [dismissed, setDismissed] = useState(false);

  const isPresent = searchParams.get(FAULT_REPORTED_PARAM) === "1";

  if (!isPresent || dismissed) {
    return null;
  }

  function handleDismiss() {
    // Latch first, so the render that follows the navigation is already
    // suppressed and cannot flash the panel back.
    setDismissed(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(FAULT_REPORTED_PARAM);
        return next;
      },
      { replace: true, preventScrollReset: true }
    );
  }

  return (
    <RepairNoticePanel
      tone="success"
      title="Fault reported"
      dismissible
      onDismiss={handleDismiss}
      className="mb-3"
    >
      <p>
        Thanks — this item is now out of action and the team leads have been
        told. There's nothing else you need to do.
      </p>
    </RepairNoticePanel>
  );
}

/** Props for {@link OutOfActionPanel}. */
type OutOfActionPanelProps = {
  /** Whether the asset has an open fault report. Renders nothing when `false`. */
  hasOpenRepair: boolean;
  /** Asset the panel belongs to — half of the close POST URL (US-005). */
  assetId: string;
  /** Rendered in the dialog's subtitle and consequence line. */
  assetTitle: string;
  /**
   * The open repair's id, from the same layout-loader select as
   * `hasOpenRepair`. `null` outside the asset-detail route tree.
   */
  openRepairId: string | null;
  /**
   * Whether the viewer holds `assetRepair:update` (`OWNER` / `ADMIN`).
   *
   * ⚠️ Cosmetic only. The route action's `requirePermission` is the
   * enforcement (US-005 AC9); this just avoids offering a button that 403s.
   */
  canMarkAsRepaired: boolean;
};

/**
 * Roughly the most characters that fit in the clamped three lines of fault text
 * at this panel's width. Above it, the `Show more` toggle is offered.
 */
const CLAMPED_FAULT_MIN_LENGTH = 200;

/**
 * `4` → `4th`, for "This is the 4th fault recorded on this item."
 *
 * English ordinals, and the 11–13 exception is the whole reason this is not a
 * one-line lookup on the last digit: 11th/12th/13th, but 21st/22nd/23rd.
 *
 * @param value - A positive whole number
 * @returns The number with its ordinal suffix
 */
function toOrdinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/**
 * The permanent "this item cannot be booked" panel.
 *
 * **Degrades by role, and the degradation is server-side.** `design.md` §6.3
 * gives `BASE` and above the fault text, the reporter, the repeat count and a
 * "View fault history" link; `SELF_SERVICE` gets the heading and the first
 * sentence only. That split is not enforced here — the layout loader ships
 * `repairSummary: null` to anyone without `assetRepair:read` (`DECISIONS.md`
 * #35), so this component simply has nothing to render for them. Client-side
 * hiding of data already in the payload would not be a control at all.
 *
 * US-005's "Mark as repaired" button is the panel's `actions` slot, shown only
 * to roles that can actually close a repair. `BASE` and `SELF_SERVICE` see the
 * panel with no button, never a disabled one (§6.3's role table).
 *
 * @param props - See {@link OutOfActionPanelProps}
 * @returns The danger panel, or `null` when the asset is healthy
 */
export function OutOfActionPanel({
  hasOpenRepair,
  assetId,
  assetTitle,
  openRepairId,
  canMarkAsRepaired,
}: OutOfActionPanelProps) {
  const summary = useAssetRepairSummary();
  const [faultExpanded, setFaultExpanded] = useState(false);

  if (!hasOpenRepair) {
    return null;
  }

  /**
   * `null` for `SELF_SERVICE` (no `assetRepair:read`) — and also `null` in the
   * one race worth naming: the repair was closed in another tab between this
   * page's loader running and now. `hasOpenRepair` and the summary come from
   * the SAME loader run, so they cannot actually disagree; the optional
   * chaining is honesty about the type, not a guard against a live state.
   */
  const openRepair = summary?.openRepair ?? null;

  /**
   * US-008 / `design.md` §6.3's second panel. A written-off repair keeps
   * `closedAt = NULL` (#37), so `hasOpenRepair` is TRUE for scrapped gear —
   * which means without this branch the page tells someone their binned cable
   * "has an open fault report and can't be booked until the repair is marked
   * complete". It is never being marked complete.
   */
  const isWrittenOff = openRepair?.state === "written-off";

  /**
   * Both conditions matter. Without `openRepairId` there is no URL to post to,
   * and rendering the launcher anyway would give the lead a button that 404s
   * — the failure `.claude/rules/resolve-nullish-button-to.md` describes for
   * `to`, reached by a different route.
   */
  const canLaunchClose =
    canMarkAsRepaired && openRepairId !== null && !isWrittenOff;

  /**
   * US-012 — the way back, offered only on a written-off item.
   *
   * Gated on the SAME `canMarkAsRepaired` flag, because reinstate reuses
   * `assetRepair:update` rather than taking a new permission (`DECISIONS.md`
   * #50) — so AC2's `OWNER`/`ADMIN` restriction costs no extra wiring. The prop
   * name is now narrower than what it gates; renaming it would touch every
   * caller for no behavioural gain, so it is documented here instead.
   *
   * Mutually exclusive with `canLaunchClose` by construction: one requires
   * `isWrittenOff`, the other refuses it. A repair can never offer both.
   */
  const canLaunchReinstate =
    canMarkAsRepaired && openRepairId !== null && isWrittenOff;

  /**
   * `undefined` when there is nothing to offer, NOT an empty fragment: the
   * panel renders its actions row on any truthy value, and a fragment
   * containing two nulls is truthy — `SELF_SERVICE` would get an empty,
   * bottom-margined strip under the copy for no reason.
   */
  const actions =
    canLaunchClose || canLaunchReinstate || summary ? (
      <>
        {canLaunchReinstate ? (
          <ReinstateRepairDialog
            assetId={assetId}
            assetTitle={assetTitle}
            repairId={openRepairId}
            // Names the decision being overturned — see the dialog's doc.
            writtenOffByName={openRepair?.writtenOffByName}
            writtenOffAt={openRepair?.writtenOffAt}
          />
        ) : null}

        {canLaunchClose ? (
          <MarkAsRepairedDialog
            assetId={assetId}
            assetTitle={assetTitle}
            repairId={openRepairId}
            /**
             * The "Reported fault" block `design.md` §8 specified and US-005
             * shipped **unreachable** — no surface had this payload to pass
             * until US-004 put it on the layout loader. A lead closing a
             * repair now sees what they are closing.
             */
            reportedFault={
              openRepair
                ? {
                    faultDescription: openRepair.faultDescription,
                    reporterName: openRepair.reporterName,
                    reportedAt: openRepair.reportedAt,
                    daysOutOfAction: openRepair.daysOutOfAction,
                  }
                : undefined
            }
          />
        ) : null}

        {/*
            Present for everyone who can read the history — including `BASE`,
            who cannot close a repair but is explicitly granted the history
            (`DECISIONS.md` #35). Absent, never disabled, for `SELF_SERVICE`.
          */}
        {summary ? (
          <Button
            to={`/assets/${assetId}/repairs`}
            variant="secondary"
            size="sm"
          >
            View fault history
          </Button>
        ) : null}
      </>
    ) : undefined;

  return (
    <RepairNoticePanel
      // Neutral, not danger: written off is settled and finished — nobody needs
      // to act — whereas an open fault is a job somebody has to do (D2).
      tone={isWrittenOff ? "neutral" : "danger"}
      title={isWrittenOff ? "Written off" : "Out of action"}
      className="mb-3"
      actions={actions}
    >
      {isWrittenOff ? (
        <p>
          This item was written off as beyond repair. It can't be booked or
          checked out.
        </p>
      ) : (
        <p>
          This item has an open fault report and can't be booked or checked out.
        </p>
      )}

      {openRepair ? (
        <>
          {/*
            The fault as typed, in quotation marks because it is someone's
            words and not ours. Plain text — it never goes through Markdoc on
            this surface.
          */}
          <p
            className={
              faultExpanded ? "mt-2 italic" : "mt-2 line-clamp-3 italic"
            }
          >
            “{openRepair.faultDescription}”
          </p>

          {/*
            Visible and focusable rather than a tooltip: this text is the whole
            point of the panel and must be reachable on touch (§6.7). The
            length guard exists because `line-clamp-3` only truncates what
            actually overflows.
          */}
          {openRepair.faultDescription.length > CLAMPED_FAULT_MIN_LENGTH ? (
            <Button
              type="button"
              variant="link"
              className="mt-1 text-xs"
              onClick={() => setFaultExpanded((expanded) => !expanded)}
            >
              {faultExpanded ? "Show less" : "Show more"}
            </Button>
          ) : null}

          <p className="mt-1 text-sm">
            Reported by {openRepair.reporterName} on{" "}
            <DateS date={openRepair.reportedAt} />
          </p>

          {/*
            AC3, on the screen a lead lands on first. Shown only from the
            SECOND fault onwards: "This is the 1st fault recorded on this item"
            is noise on an item that has simply broken once.
          */}
          {summary && summary.count > 1 ? (
            <p className="mt-1 text-sm font-medium">
              This is the {toOrdinal(summary.count)} fault recorded on this
              item.
            </p>
          ) : null}
        </>
      ) : null}
    </RepairNoticePanel>
  );
}
