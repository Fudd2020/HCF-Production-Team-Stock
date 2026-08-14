/**
 * The chip(s) a repair's history state renders as (`design.md` §17.4).
 *
 * One component for every surface — the Repairs tab, the Overview
 * fault-history card and, when US-008 gives `/repairs` its mixed `all` bucket,
 * that status cell too. The states themselves are derived once, server-side,
 * by `resolveRepairHistoryState`; this only paints them.
 *
 * **`reinstated` is two chips, not one, and that is the whole reason this is a
 * component rather than a lookup table.** `Reinstated` alone erases the
 * write-off (`DECISIONS.md` #47); `Written off` alone says the item is dead
 * when it is bookable again. Two chips read left-to-right as the history
 * happened — scrapped, then brought back — the same precedent as `design.md`
 * D2's `In repair` + `Checked out` pair.
 *
 * Colours come from `BADGE_COLORS` and are measured against AA in §17.4's
 * table. **Do not lighten `Repaired`** — at 4.56:1 it clears 4.5:1 by a thin
 * margin (`.claude/rules/use-badge-colors.md`).
 *
 * @see {@link file://./../../modules/asset-repair/history-state.ts}
 */

import type { RepairHistoryState } from "~/modules/asset-repair/history-state";
import { BADGE_COLORS } from "~/utils/badge-colors";
import { tw } from "~/utils/tw";
import { Badge } from "../shared/badge";

/** The colour scheme and word for each single-chip state. */
const SINGLE_CHIP: Record<
  Exclude<RepairHistoryState, "reinstated">,
  { label: string; scheme: keyof typeof BADGE_COLORS }
> = {
  // Problem indicator — someone has to act (`design.md` D2).
  open: { label: "In repair", scheme: "red" },
  // The outcome was good. Green, and never "Closed": with four states that
  // word describes two visually different things (§17.4 decision 1).
  repaired: { label: "Repaired", scheme: "green" },
  // Settled and finished; nobody needs to act.
  "written-off": { label: "Written off", scheme: "gray" },
};

/**
 * `Reinstated`'s own scheme — blue, because a reinstate is an **amendment to
 * the record**, not an outcome. `.claude/rules/reports-styling.md` uses blue
 * for `UPDATED` / `*_CHANGED`, which is the same meaning.
 */
const REINSTATED_SCHEME = "blue" as const;

/** Props for {@link RepairStateBadge}. */
type RepairStateBadgeProps = {
  /** The state, as derived server-side. Never re-derive it from `closedAt`. */
  state: RepairHistoryState;
  /** Extra classes for the wrapper — the card is narrow and wraps, the table does not. */
  className?: string;
};

/**
 * Renders a repair's state as one chip, or two for `reinstated`.
 *
 * Colour is never the only signal (`design.md` §13 item 3): every chip carries
 * its own word, so the state survives greyscale, colour-blindness and a screen
 * reader.
 *
 * @param props - See {@link RepairStateBadgeProps}
 * @returns The chip or chip pair
 */
export function RepairStateBadge({ state, className }: RepairStateBadgeProps) {
  if (state === "reinstated") {
    return (
      <span className={tw("flex flex-wrap items-center gap-1", className)}>
        <Badge
          color={BADGE_COLORS["gray"].bg}
          textColor={BADGE_COLORS["gray"].text}
        >
          {SINGLE_CHIP["written-off"].label}
        </Badge>
        <Badge
          color={BADGE_COLORS[REINSTATED_SCHEME].bg}
          textColor={BADGE_COLORS[REINSTATED_SCHEME].text}
        >
          Reinstated
        </Badge>
      </span>
    );
  }

  const { label, scheme } = SINGLE_CHIP[state];

  return (
    <span className={tw("flex flex-wrap items-center gap-1", className)}>
      <Badge
        color={BADGE_COLORS[scheme].bg}
        textColor={BADGE_COLORS[scheme].text}
      >
        {label}
      </Badge>
    </span>
  );
}
