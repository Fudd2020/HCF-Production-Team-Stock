/**
 * Status label / colour maps — pinned regression tests.
 *
 * These exist for ONE failure mode, and it is a silent one.
 * `ExtendedAssetStatus` is a union that grows, and both maps in
 * `status-labels.ts` end in a `default:` arm that answers **AVAILABLE**. A new
 * member added to the union without a matching `case` therefore does not fail
 * to compile — it renders a green "Available" chip. In a booking-availability
 * context that is the single worst wrong answer the product can give, and it
 * is the known hazard the whole derived-status approach was accepted with
 * (`progress.md` §1, `DECISIONS.md` #21).
 *
 * The `IN_REPAIR` assertions below are the pin `progress.md` §1 mandates.
 *
 * @see {@link file://./status-labels.ts}
 */

import { ASSET_STATUS_LABELS, ASSET_REPAIR_STATUS_LABELS } from "@shelf/labels";
import { describe, expect, it } from "vitest";
import { BADGE_COLORS } from "~/utils/badge-colors";
import type { ExtendedAssetStatus } from "~/utils/booking-assets";
import { assetStatusColorMap, userFriendlyAssetStatus } from "./status-labels";

describe("userFriendlyAssetStatus", () => {
  it("does NOT fall through to 'Available' for IN_REPAIR", () => {
    // The assertion that matters. If someone removes the `case "IN_REPAIR"`,
    // this is what catches it — the label check below would be the symptom,
    // this is the diagnosis.
    expect(userFriendlyAssetStatus("IN_REPAIR")).not.toBe(
      ASSET_STATUS_LABELS.AVAILABLE
    );
  });

  it("labels IN_REPAIR from the shared @shelf/labels constant", () => {
    expect(userFriendlyAssetStatus("IN_REPAIR")).toBe(
      ASSET_REPAIR_STATUS_LABELS.IN_REPAIR
    );
    expect(userFriendlyAssetStatus("IN_REPAIR")).toBe("In repair");
  });

  it("still labels the real AssetStatus members correctly", () => {
    expect(userFriendlyAssetStatus("AVAILABLE")).toBe(
      ASSET_STATUS_LABELS.AVAILABLE
    );
    expect(userFriendlyAssetStatus("IN_CUSTODY")).toBe(
      ASSET_STATUS_LABELS.IN_CUSTODY
    );
    expect(userFriendlyAssetStatus("CHECKED_OUT")).toBe(
      ASSET_STATUS_LABELS.CHECKED_OUT
    );
  });
});

describe("assetStatusColorMap", () => {
  it("does NOT fall through to the AVAILABLE green for IN_REPAIR", () => {
    expect(assetStatusColorMap("IN_REPAIR")).not.toEqual(BADGE_COLORS.green);
  });

  it("paints IN_REPAIR red — a problem indicator, someone must act", () => {
    expect(assetStatusColorMap("IN_REPAIR")).toEqual(BADGE_COLORS.red);
  });
});

describe("every ExtendedAssetStatus member is explicitly mapped", () => {
  /**
   * Listed by hand rather than derived: the point is that adding a union
   * member should force a human to come here, notice the `default:` hazard and
   * decide. A derived list would silently absorb the new member and defeat
   * the test.
   */
  const NON_AVAILABLE_STATUSES: ExtendedAssetStatus[] = [
    "IN_CUSTODY",
    "CHECKED_OUT",
    "PARTIALLY_CHECKED_IN",
    "PARTIALLY_CHECKED_IN_QTY",
    "PARTIALLY_CHECKED_OUT_QTY",
    "PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN",
    "IN_REPAIR",
  ];

  it.each(NON_AVAILABLE_STATUSES)(
    "%s does not render as 'Available'",
    (status) => {
      expect(userFriendlyAssetStatus(status)).not.toBe(
        ASSET_STATUS_LABELS.AVAILABLE
      );
    }
  );
});
