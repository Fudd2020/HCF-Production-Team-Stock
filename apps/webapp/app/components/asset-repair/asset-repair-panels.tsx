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
import { RepairNoticePanel } from "./repair-notice-panel";

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

/**
 * The permanent "this item cannot be booked" panel.
 *
 * ⚠️ **Deliberately impersonal, and deliberately thin.** `design.md` §6.3
 * additionally shows the fault text, the reporter and the repeat count to
 * `BASE` and above, plus "Mark as repaired" / "View fault history" buttons.
 * All of that is loader data and routes that arrive with US-004 and US-005;
 * the copy here is the fallback §6.3 already specifies and is sufficient for
 * US-001 AC3 and US-007 AC7 on its own.
 *
 * @param props.hasOpenRepair - Whether the asset has an open fault report
 * @returns The danger panel, or `null` when the asset is healthy
 */
export function OutOfActionPanel({
  hasOpenRepair,
}: {
  hasOpenRepair: boolean;
}) {
  if (!hasOpenRepair) {
    return null;
  }

  return (
    <RepairNoticePanel tone="danger" title="Out of action" className="mb-3">
      <p>
        This item has an open fault report and can't be booked or checked out.
      </p>
    </RepairNoticePanel>
  );
}
