/**
 * Overview sidebar — the fault-history summary card (`design.md` §6.6).
 *
 * Modelled on `AssetReminderCards` line for line: a header row with the title
 * and a `View all` link, then rows. It answers US-004 AC3 — "the number of past
 * faults is visible without opening a sub-page or counting rows manually" — on
 * the screen a lead lands on first, while the `Repairs (n)` tab label answers
 * it from every other tab.
 *
 * **It renders nothing when the asset has no faults**, exactly as
 * `AssetReminderCards` does. `design.md` D1 is explicit that the empty state
 * ("No faults recorded") belongs on the tab, which is always present: an empty
 * card on every healthy asset would be chrome, not information.
 *
 * @see {@link file://./../../routes/_layout+/assets.$assetId.repairs._index.tsx}
 * @see {@link file://./../../hooks/use-asset-repair-state.ts}
 */

import type { CSSProperties } from "react";

import { useAssetRepairSummary } from "~/hooks/use-asset-repair-state";
import { tw } from "~/utils/tw";
import { RepairStateBadge } from "./repair-state-badge";
import { Button } from "../shared/button";
import { DateS } from "../shared/date";

/** Props for {@link FaultHistoryCard}. */
type FaultHistoryCardProps = {
  /** The asset being viewed — the `View all` destination. */
  assetId: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * The fault-history card, or nothing.
 *
 * Returns `null` in two different situations that must not be conflated: the
 * asset has never had a fault (`count === 0`), and the viewer may not read
 * fault history at all (`summary === null` — `SELF_SERVICE`, per
 * `DECISIONS.md` #35). Both render as absence here, but only the first is
 * "good news"; the tab is likewise hidden for the second.
 *
 * @param props - See {@link FaultHistoryCardProps}
 * @returns The card, or `null`
 */
export function FaultHistoryCard({
  assetId,
  className,
  style,
}: FaultHistoryCardProps) {
  const summary = useAssetRepairSummary();

  if (!summary || summary.count === 0) {
    return null;
  }

  return (
    <div className={tw("rounded border bg-white", className)} style={style}>
      <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h5>Fault history</h5>
          {/*
            The count pill — `.claude/rules/reports-styling.md`'s count-badge
            pattern. It states the ALL-TIME total, not the number of rows below
            it: three rows and a `12` is the repeat offender becoming obvious,
            which is the entire point of AC3.
          */}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {summary.count}
          </span>
        </div>

        <Button
          to={`/assets/${assetId}/repairs`}
          variant="block-link-gray"
          className="!mt-0"
        >
          View all
        </Button>
      </div>

      {summary.recent.map((repair) => (
        <div key={repair.id} className="border-b px-4 py-3 last:border-b-0">
          <RepairStateBadge state={repair.state} className="mb-2" />

          {/*
            Plain user text, rendered as text — see the row component on the
            tab for why the Markdoc rule does not reach this surface. Clamped
            to one line here; the tab carries the full text with a toggle.
          */}
          <p className="mb-1 line-clamp-1 text-sm text-gray-700">
            {repair.faultDescription}
          </p>

          <p className="text-xs text-gray-500">
            Reported <DateS date={repair.reportedAt} />
          </p>
        </div>
      ))}
    </div>
  );
}
