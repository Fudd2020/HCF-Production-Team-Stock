/**
 * Asset Repair — booking availability guard (READ-ONLY).
 *
 * This is the ONLY module `booking/service.server.ts` and
 * `booking-model-request/service.server.ts` import from the repairs feature.
 * It is deliberately split from `./service.server.ts` (the write path) so the
 * booking services never pull in the note / activity-event helpers, which would
 * create an import cycle back through `~/modules/note/service.server`.
 *
 * ## The predicate
 *
 * An asset is **out of action** while it has an `AssetRepair` row with
 * `closedAt IS NULL`. That single condition is the WHOLE bookability rule
 * (`DECISIONS.md` #31, reaffirmed by #37) — no stage, status or outcome may
 * ever become a second input here. A written-off repair is deliberately never
 * closed, which is how scrapped gear stays out of the pool through this one
 * rule (`DECISIONS.md` #36/#37).
 *
 * Nothing in this module (or anywhere else in the repairs feature) reads or
 * writes `Asset.availableToBook`. A repair **overrides** that flag; it never
 * mutates it (`DECISIONS.md` #22). Consumers AND the two together via
 * {@link isAssetBookable} in `~/utils/booking-assets`.
 *
 * ## Hot-path rules
 *
 * Both helpers take an ARRAY and run exactly ONE query. The booking picker and
 * asset index render many rows — never call these per row (US-002 "Notes for
 * the technical team"). When the caller already runs a `findMany` over the
 * assets in question, prefer {@link OPEN_REPAIR_SELECT} +
 * {@link assertNoOpenRepairsInLoadedAssets} instead, which costs zero extra
 * round-trips.
 *
 * @see {@link file://./service.server.ts} the write path (report / close)
 * @see {@link file://./../booking/service.server.ts} the six guarded chokepoints
 */

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

const label = "Asset Repair" as const;

/**
 * Minimal Prisma surface these guards need. Both the extended top-level client
 * and an interactive transaction client satisfy this structurally, so callers
 * can pass either without type gymnastics — the same approach as
 * `OrgValidationTxClient` and `RecordEventTxClient`.
 */
export type AssetRepairAvailabilityTxClient = {
  assetRepair: {
    findMany: (args: {
      where: {
        assetId: { in: string[] };
        organizationId: string;
        closedAt: null;
      };
      select:
        | { assetId: true }
        | { assetId: true; asset: { select: { title: true } } };
    }) => Promise<Array<{ assetId: string; asset?: { title: string } | null }>>;
  };
};

/**
 * The two Prisma fragments live in the pure sibling module so that shared
 * `select` definitions which are ALSO reachable from the client module graph
 * (`~/modules/asset/fields.ts`, `~/modules/kit/types.ts`) can use them without
 * importing a `*.server` module
 * (`.claude/rules/no-server-module-in-route-client-exports.md`). Re-exported
 * here so every existing server import keeps working and the guards below stay
 * co-located with the fragment they document.
 */
export {
  HEALTHY_ASSET_WHERE,
  OPEN_REPAIR_SELECT,
} from "~/modules/asset-repair/predicates";

/**
 * The asset ids (of those passed in) that currently have an OPEN repair.
 *
 * ONE query, org-scoped. Returns an empty set for an empty input without
 * touching the database, so the "organisation with no repairs" case in US-002's
 * edge cases costs nothing on the booking hot path.
 *
 * @param args.assetIds - Candidate asset ids (may contain duplicates)
 * @param args.organizationId - The caller's session organization. Never taken
 *   from the request — an open repair in org B must not affect org A (US-002 AC11)
 * @param tx - Optional transaction client. Pass the active `tx` so the read is
 *   part of the same transaction as the write it guards (US-002's concurrency
 *   edge case: reporting a fault in one tab while check-out submits in another)
 * @returns Set of asset ids with an open repair
 */
export async function getOpenRepairAssetIds(
  { assetIds, organizationId }: { assetIds: string[]; organizationId: string },
  tx?: AssetRepairAvailabilityTxClient
): Promise<Set<string>> {
  if (assetIds.length === 0) return new Set();

  const client = tx ?? db;

  const rows = await client.assetRepair.findMany({
    where: {
      assetId: { in: [...new Set(assetIds)] },
      organizationId,
      // The whole predicate. See the module doc — do not add a second input.
      closedAt: null,
    },
    select: { assetId: true },
  });

  return new Set(rows.map((row) => row.assetId));
}

/**
 * Refuses the operation if ANY of the supplied assets has an open repair.
 *
 * ONE query, org-scoped, and it joins the asset title so the message can name
 * the offending items without a second round-trip.
 *
 * @param args.assetIds - Candidate asset ids (may contain duplicates)
 * @param args.organizationId - The caller's session organization (US-002 AC11)
 * @param tx - Optional transaction client; pass the active `tx` so the check is
 *   atomic with the mutation it guards
 * @throws {ShelfError} 400, `shouldBeCaptured: false` (US-002 AC9 — a business
 *   refusal, not an application error) when any asset is out of action
 */
export async function assertNoOpenRepairs(
  { assetIds, organizationId }: { assetIds: string[]; organizationId: string },
  tx?: AssetRepairAvailabilityTxClient
): Promise<void> {
  if (assetIds.length === 0) return;

  const client = tx ?? db;

  const openRepairs = await client.assetRepair.findMany({
    where: {
      assetId: { in: [...new Set(assetIds)] },
      organizationId,
      closedAt: null,
    },
    select: { assetId: true, asset: { select: { title: true } } },
  });

  if (openRepairs.length === 0) return;

  throw buildOpenRepairError(
    openRepairs.map((repair) => repair.asset?.title ?? "Unknown item"),
    { organizationId }
  );
}

/**
 * Zero-extra-query variant of {@link assertNoOpenRepairs} for callers that have
 * ALREADY loaded the assets with {@link OPEN_REPAIR_SELECT}.
 *
 * `updateBookingAssets` runs exactly such a `findMany` (its `validAssets`
 * lookup), so widening that select and calling this keeps the booking hot path
 * at its current query count — which US-002's "empty state" edge case requires.
 *
 * Pure: it performs no I/O, so it cannot introduce a race of its own. The read
 * that produced `assets` must itself be inside the guarding transaction.
 *
 * @param assets - Rows carrying `title` and a `repairs` array already filtered
 *   to open repairs (that is what {@link OPEN_REPAIR_SELECT} produces)
 * @throws {ShelfError} 400, `shouldBeCaptured: false` when any asset is out of action
 */
export function assertNoOpenRepairsInLoadedAssets(
  assets: Array<{ title: string; repairs: Array<{ id: string }> }>
): void {
  const outOfAction = assets.filter((asset) => asset.repairs.length > 0);

  if (outOfAction.length === 0) return;

  throw buildOpenRepairError(outOfAction.map((asset) => asset.title));
}

/**
 * Builds the shared refusal error.
 *
 * One message for every chokepoint, deliberately: the companion app renders the
 * raw string in its generic error UI with no repairs screen to explain it
 * (`DECISIONS.md` #32), so the copy has to be self-contained — name the items,
 * say they have an open fault report, say what unblocks them.
 *
 * Naming at most three items then "and N more" matches the existing
 * conflict/custody convention in `booking/service.server.ts`.
 *
 * @param titles - Titles of the out-of-action assets
 * @param additionalData - Debug context attached to the error
 * @returns The `ShelfError` to throw
 */
function buildOpenRepairError(
  titles: string[],
  additionalData?: Record<string, unknown>
): ShelfError {
  const named = titles.slice(0, 3).join(", ");
  const additionalCount = titles.length > 3 ? titles.length - 3 : 0;
  const additionalText =
    additionalCount > 0 ? ` and ${additionalCount} more` : "";

  return new ShelfError({
    cause: null,
    label,
    status: 400,
    title: "Item out of action",
    message: `Some items have an open fault report and are out of action: ${named}${additionalText}. They cannot be booked or checked out until the repair is marked complete.`,
    // US-002 AC9: an expected business refusal, not an application error.
    // Mirrors the conflict/custody guards it sits alongside.
    shouldBeCaptured: false,
    additionalData: { ...additionalData, outOfActionCount: titles.length },
  });
}
