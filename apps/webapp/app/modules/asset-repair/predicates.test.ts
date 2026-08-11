/**
 * Asset Repair — shared predicate tests.
 *
 * Two things are pinned here:
 *
 *  1. The predicate itself is `closedAt IS NULL` and NOTHING else
 *     (`DECISIONS.md` #31, permanent).
 *  2. Every list surface that renders the "In repair" chip actually ships the
 *     `repairs` relation in the query it already runs — i.e. no surface falls
 *     back to a per-row lookup, and no surface silently renders no chip
 *     (US-001 AC3).
 *
 * No mocks: these are pure values and a pure function.
 *
 * @see {@link file://./predicates.ts}
 */

import { describe, expect, it } from "vitest";
import { assetIndexFields } from "~/modules/asset/fields";
import { KIT_SELECT_FIELDS_FOR_LIST_ITEMS } from "~/modules/kit/types";
import {
  deriveHasOpenRepair,
  HEALTHY_ASSET_WHERE,
  OPEN_REPAIR_SELECT,
} from "./predicates";

describe("OPEN_REPAIR_SELECT", () => {
  it("filters on closedAt IS NULL and nothing else", () => {
    // DECISIONS.md #31: no stage, status or outcome may ever become a second
    // input. US-008 adds an `outcome` column — it must not land here.
    expect(OPEN_REPAIR_SELECT.where).toEqual({ closedAt: null });
  });

  it("asks for existence only, not the whole row", () => {
    // `take: 1` is safe because the partial unique index
    // `AssetRepair_assetId_open_key` allows at most one open repair per asset.
    // `select: { id }` keeps the list payload flat on a 500-row index.
    expect(OPEN_REPAIR_SELECT.take).toBe(1);
    expect(OPEN_REPAIR_SELECT.select).toEqual({ id: true });
  });
});

describe("HEALTHY_ASSET_WHERE", () => {
  it("selects assets with no open repair", () => {
    expect(HEALTHY_ASSET_WHERE).toEqual({
      repairs: { none: { closedAt: null } },
    });
  });
});

describe("deriveHasOpenRepair", () => {
  it("is false when the asset has no open repair", () => {
    expect(deriveHasOpenRepair({ repairs: [] })).toBe(false);
  });

  it("is true when the asset has an open repair", () => {
    expect(deriveHasOpenRepair({ repairs: [{ id: "repair-1" }] })).toBe(true);
  });

  /**
   * The dangerous direction is **silent-healthy**: a surface that forgot to
   * widen its `select` reporting "no open repair" and rendering no chip, with
   * nothing failing. `AssetWithOpenRepairSelect.repairs` is required precisely
   * to make that a compile error, and the helper deliberately does not defend
   * with `?? []` at runtime. Both halves of that contract are pinned here — if
   * someone "hardens" the helper with a nullish default, these fail.
   */
  it("refuses at compile time to accept a row without `repairs`", () => {
    // If `repairs` ever becomes optional, TypeScript stops erroring here and
    // the unused-directive rule turns this line into a typecheck failure. The
    // pin therefore works in BOTH directions.
    // @ts-expect-error -- `repairs` is required on purpose (silent-healthy guard)
    const call = () => deriveHasOpenRepair({});

    expect(typeof call).toBe("function");
  });

  it("throws rather than reporting healthy when `repairs` is missing at runtime", () => {
    // Types are erased at runtime, and several surfaces build this shape from
    // hand-written mirrors of the loader select rather than from inferred
    // loader types. If such a mirror drifts, this must be a loud crash, not a
    // chip that quietly never renders.
    expect(() =>
      deriveHasOpenRepair(
        // Deliberately unsound: models a loader that dropped the relation.
        undefined as unknown as { repairs: Array<{ id: string }> }
      )
    ).toThrow();

    expect(() =>
      deriveHasOpenRepair({} as unknown as { repairs: Array<{ id: string }> })
    ).toThrow();
  });

  it("does not re-check closedAt — the select already filtered", () => {
    // The array reaching this helper is produced by OPEN_REPAIR_SELECT, so
    // every element is by construction an OPEN repair. Re-deriving from a
    // `closedAt` field here would be a second source of truth.
    expect(Object.keys(OPEN_REPAIR_SELECT.select)).toEqual(["id"]);
  });
});

/**
 * The chip is only as good as the loaders behind it. These assert the shared
 * `select` definitions carry `repairs`, so a surface cannot lose the chip by
 * someone trimming a select — the frontend prop defaults to `false`, which
 * would fail silently.
 */
describe("shared selects ship the repairs relation", () => {
  it("assetIndexFields includes it (simple asset index + all three pickers)", () => {
    expect(assetIndexFields()).toMatchObject({ repairs: OPEN_REPAIR_SELECT });
  });

  it("assetIndexFields keeps it on the booking-dates branch", () => {
    // That branch REPLACES `bookingAssets` and returns a fresh object; a
    // careless edit there is how the field would go missing on the booking
    // picker specifically.
    const fields = assetIndexFields({
      bookingFrom: new Date("2026-01-01"),
      bookingTo: new Date("2026-01-02"),
      unavailableBookingStatuses: ["RESERVED"],
    });

    expect(fields).toMatchObject({ repairs: OPEN_REPAIR_SELECT });
  });

  it("the kit page's asset select includes it", () => {
    // A fault is reported against a MEMBER asset, never the kit
    // (`DECISIONS.md` #16), so a kit's asset list is where a broken member has
    // to be visible.
    expect(KIT_SELECT_FIELDS_FOR_LIST_ITEMS).toMatchObject({
      repairs: OPEN_REPAIR_SELECT,
    });
  });
});
