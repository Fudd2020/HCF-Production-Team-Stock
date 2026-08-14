/**
 * The ONE derivation of a repair's history state (US-004 AC9, `design.md`
 * §17.4).
 *
 * A repair has **four** states, not two, and `closedAt` alone can never tell
 * you which. Two decisions taken elsewhere in this feature make the obvious
 * ternary wrong in both directions:
 *
 * - A **written-off** repair keeps `closedAt = NULL` for ever
 *   (`DECISIONS.md` #37) — that is precisely what keeps scrapped gear out of
 *   the bookable pool, since bookability is `closedAt IS NULL` and only that
 *   (#31). So `closedAt ? "Repaired" : "Open"` labels scrapped gear as
 *   *awaiting repair*.
 * - **Reinstating** stamps `closedAt` (#46) while `outcome` stays
 *   `WRITTEN_OFF` for ever (#47). So the same ternary then labels
 *   scrapped-then-recovered gear *"Repaired"* — which it never was.
 *
 * Hence the branch order below: **`outcome` → `reinstatedAt` → `closedAt`**.
 * Testing `closedAt` first is the exact lie `DECISIONS.md` #51 was written to
 * prevent.
 *
 * **Only two of the four states are reachable today.** Neither `outcome`
 * (US-008) nor `reinstatedAt` (US-012) exists as a column yet, so both are
 * optional on the input type and always arrive `undefined`. That is
 * deliberate: US-004 AC9's Definition of Done requires the derivation to live
 * in one named helper *so that US-008 and US-012 each extend one place*
 * instead of every surface that renders a repair. When those columns land,
 * this function needs no change at all — only the `select` clauses that feed
 * it.
 *
 * Deliberately **not** a `*.server` module: `/repairs`, the asset's Repairs
 * tab and the Overview fault-history card all render from it, and the same
 * function must decide for all of them.
 *
 * @see {@link file://./service.server.ts} — computes `state` onto every payload
 * @see {@link file://./../../components/asset-repair/repair-state-badge.tsx}
 */

/**
 * What a repair reads as in the history.
 *
 * `"written-off"` and `"reinstated"` are unreachable until US-008 / US-012
 * ship their columns; they are in the union from day one so that a `switch`
 * over this type is exhaustive now and stays exhaustive then.
 */
export type RepairHistoryState =
  | "open"
  | "repaired"
  | "written-off"
  | "reinstated";

/**
 * The minimum a repair row must carry for {@link resolveRepairHistoryState}.
 *
 * Every field accepts `string` as well as `Date` because loader payloads cross
 * the wire as JSON: the same row is a `Date` in a service test and an ISO
 * string in a component. Only nullness is ever inspected, so both work without
 * a parse.
 */
export type RepairForStateResolution = {
  /** `NULL` while the item is out of action. Stamped by a close (US-005) or a reinstate (US-012). */
  closedAt: Date | string | null;
  /**
   * `RepairOutcome` once US-008 adds the column — today always `undefined`.
   * Non-null means the repair ended in a write-off, whatever `closedAt` says.
   */
  outcome?: string | null;
  /** Stamped by US-012's reinstate. Non-null only ever alongside `outcome`. */
  reinstatedAt?: Date | string | null;
};

/**
 * Derives which of the four states a repair is in.
 *
 * @param repair - A repair row carrying at least `closedAt`
 * @returns The state this repair should render as
 */
export function resolveRepairHistoryState(
  repair: RepairForStateResolution
): RepairHistoryState {
  /**
   * `outcome` FIRST. A written-off repair may have `closedAt` set (reinstated)
   * or null (still scrapped), so neither value of `closedAt` can be trusted to
   * describe it. Once the write-off is established, `reinstatedAt` picks
   * between the two write-off states.
   */
  if (repair.outcome != null) {
    return repair.reinstatedAt != null ? "reinstated" : "written-off";
  }

  // No outcome recorded: `closedAt` now means what it appears to mean.
  return repair.closedAt != null ? "repaired" : "open";
}

/**
 * The word each state is described by in prose — error messages, `aria-label`s
 * and anywhere a chip is not what is wanted.
 *
 * The chips themselves live in `RepairStateBadge`, because the `"reinstated"`
 * state renders as **two** chips (`Written off` then `Reinstated`) and cannot
 * be expressed as one string (`design.md` §17.4 decision 2).
 */
export const REPAIR_HISTORY_STATE_LABELS: Record<RepairHistoryState, string> = {
  open: "In repair",
  repaired: "Repaired",
  "written-off": "Written off",
  reinstated: "Written off, then reinstated",
};
