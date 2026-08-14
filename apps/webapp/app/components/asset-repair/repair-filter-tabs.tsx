/**
 * Repair Filter Tabs — the three-bucket segmented control on `/repairs`.
 *
 * Switches the out-of-action list between "awaiting repair", "written off" and
 * "all" (US-003, `design.md` §9/§10). Built from react-router `Link`s rather
 * than buttons with a callback **because this control's state lives in the
 * URL** — the loader reads `?filter=`, so a bucket must be shareable,
 * bookmarkable and survive a refresh.
 *
 * Visually the same segmented pill group as `IdleThresholdSelector`
 * (`~/components/reports/idle-threshold-selector`), deliberately NOT reused: it
 * is typed `value: number` + `onChange` and is coupled to a report route's
 * client state. Neither the type nor the mechanism fits, and generalising it
 * would touch a shipping report for no benefit (`design.md` §10).
 *
 * @see {@link file://./../../routes/_layout+/repairs._index.tsx} the only call site
 */

import { Link } from "react-router";

// why: the repo's own wrapper, not react-router's — `no-restricted-imports`
// blocks the raw hook so every surface shares the same search-param behaviour.
import { useSearchParams } from "~/hooks/search-params";
import type { RepairListFilter } from "~/modules/asset-repair/schema";
import { tw } from "~/utils/tw";

/** Props for {@link RepairFilterTabs}. */
type RepairFilterTabsProps = {
  /** The bucket currently shown. Comes from the loader, not from local state. */
  active: RepairListFilter;
  /**
   * Per-bucket totals, rendered in the tab labels so a lead can see there is
   * written-off gear without switching to look.
   */
  counts: { awaiting: number; writtenOff: number };
};

/**
 * One tab's definition. Module scope so the array identity is stable across
 * renders (`.claude/rules/react-render-stability.md`).
 */
const TABS: ReadonlyArray<{ value: RepairListFilter; label: string }> = [
  { value: "awaiting", label: "Awaiting repair" },
  { value: "written-off", label: "Written off" },
  { value: "all", label: "All" },
];

/**
 * Renders the bucket switcher.
 *
 * Each tab is a `Link` that preserves every other search param and **resets
 * `page`** — staying on page 4 while switching to a bucket with one row would
 * show an empty list and read as a bug.
 *
 * @param props.active - The bucket currently displayed
 * @param props.counts - Per-bucket totals for the labels
 */
export function RepairFilterTabs({ active, counts }: RepairFilterTabsProps) {
  const [searchParams] = useSearchParams();

  /**
   * `all` is derived rather than passed: it is definitionally the sum of the
   * two buckets, and a third loader count could disagree with them.
   */
  const countFor = (value: RepairListFilter) => {
    switch (value) {
      case "awaiting":
        return counts.awaiting;
      case "written-off":
        return counts.writtenOff;
      case "all":
        return counts.awaiting + counts.writtenOff;
    }
  };

  return (
    <div
      role="group"
      aria-label="Filter repairs"
      className="flex items-center gap-1 rounded border border-gray-200 bg-white p-1"
    >
      {TABS.map((tab) => {
        const isActive = tab.value === active;

        // Preserve search and any other params; drop `page` (see JSDoc above).
        const params = new URLSearchParams(searchParams);
        params.set("filter", tab.value);
        params.delete("page");

        return (
          <Link
            key={tab.value}
            to={`?${params.toString()}`}
            // why: `aria-current` rather than `aria-pressed` — these are links,
            // not toggle buttons, and the pressed state has no meaning for a
            // navigation control.
            aria-current={isActive ? "page" : undefined}
            preventScrollReset
            className={tw(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
              isActive
                ? "bg-primary-600 text-white"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            )}
          >
            {tab.label}{" "}
            <span
              className={tw(
                "tabular-nums",
                isActive ? "text-white/80" : "text-gray-400"
              )}
            >
              ({countFor(tab.value)})
            </span>
          </Link>
        );
      })}
    </div>
  );
}
