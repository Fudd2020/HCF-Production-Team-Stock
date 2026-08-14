/**
 * Unit tests for the four-state derivation (US-004 AC9, `design.md` §17.4).
 *
 * This helper is one `if` and a ternary, and it is still the most
 * consequential six lines in the feature: `DECISIONS.md` #51 exists because
 * the obvious `closedAt ? "Repaired" : "Open"` is wrong in BOTH directions
 * once US-008 and US-012 land, and each way it is wrong is a lie the history
 * exists to prevent.
 *
 * Two of the four states are unreachable in production today — no `outcome`
 * column, no `reinstatedAt` column. They are tested anyway, and that is the
 * point: US-004's Definition of Done requires this derivation to live in one
 * named helper so the later stories extend one place, and a helper nobody has
 * pinned to the four cases would silently accept a wrong branch order the day
 * the columns arrive.
 *
 * @see {@link file://./history-state.ts}
 */

import { describe, expect, it } from "vitest";

import {
  REPAIR_HISTORY_STATE_LABELS,
  resolveRepairHistoryState,
} from "./history-state";

/** A write-off, as US-008's `RepairOutcome` will spell it. */
const WRITTEN_OFF = "WRITTEN_OFF";

const CLOSED_AT = new Date("2026-08-10T10:00:00.000Z");
const REINSTATED_AT = new Date("2026-08-12T10:00:00.000Z");

describe("resolveRepairHistoryState", () => {
  it("reads an unclosed repair as open", () => {
    expect(resolveRepairHistoryState({ closedAt: null })).toBe("open");
  });

  it("reads a closed repair as repaired", () => {
    expect(resolveRepairHistoryState({ closedAt: CLOSED_AT })).toBe("repaired");
  });

  it("reads a written-off repair as written off, NOT as open", () => {
    /**
     * The first half of the trap. `DECISIONS.md` #37 keeps `closedAt = NULL`
     * on a written-off repair for ever — that is what keeps scrapped gear out
     * of the bookable pool under #31. A `closedAt`-first branch would label
     * this "In repair", telling the team someone is going to fix a cable that
     * was binned.
     */
    expect(
      resolveRepairHistoryState({ closedAt: null, outcome: WRITTEN_OFF })
    ).toBe("written-off");
  });

  it("reads a reinstated repair as reinstated, NOT as repaired", () => {
    /**
     * The second half. #46 stamps `closedAt` when an asset is reinstated while
     * #47 keeps `outcome = WRITTEN_OFF` for ever, so a `closedAt`-first branch
     * would label this "Repaired" — an item that was scrapped and recovered,
     * recorded as having been fixed. It never was.
     */
    expect(
      resolveRepairHistoryState({
        closedAt: CLOSED_AT,
        outcome: WRITTEN_OFF,
        reinstatedAt: REINSTATED_AT,
      })
    ).toBe("reinstated");
  });

  it("checks outcome BEFORE closedAt — the branch order, stated as a test", () => {
    /**
     * The two cases above already fail if the order is wrong; this one says so
     * directly, so a future edit that "simplifies" the function meets a test
     * whose name is the rule rather than two that look like data.
     */
    const closedAndWrittenOff = {
      closedAt: CLOSED_AT,
      outcome: WRITTEN_OFF,
    };

    expect(resolveRepairHistoryState(closedAndWrittenOff)).not.toBe("repaired");
    expect(resolveRepairHistoryState(closedAndWrittenOff)).toBe("written-off");
  });

  it("treats absent lifecycle columns as absent, not as a state", () => {
    // Today's rows arrive with neither column selected. `undefined` must read
    // exactly as `null` does, or every existing repair would render wrong the
    // moment the columns are added to some queries and not others.
    expect(
      resolveRepairHistoryState({
        closedAt: null,
        outcome: undefined,
        reinstatedAt: undefined,
      })
    ).toBe("open");
  });

  it("accepts serialized dates, because loader payloads cross the wire", () => {
    // The same row is a `Date` in a service test and an ISO string in a
    // component. Only nullness is inspected, and this pins that.
    expect(
      resolveRepairHistoryState({ closedAt: CLOSED_AT.toISOString() })
    ).toBe("repaired");
    expect(
      resolveRepairHistoryState({
        closedAt: CLOSED_AT.toISOString(),
        outcome: WRITTEN_OFF,
        reinstatedAt: REINSTATED_AT.toISOString(),
      })
    ).toBe("reinstated");
  });

  it("has a prose label for every state", () => {
    // A `Record<RepairHistoryState, string>` makes this a compile-time
    // guarantee; the test is here so a state added later without a label fails
    // loudly rather than rendering `undefined` in an error message.
    expect(Object.keys(REPAIR_HISTORY_STATE_LABELS).sort()).toEqual([
      "open",
      "reinstated",
      "repaired",
      "written-off",
    ]);
  });
});
