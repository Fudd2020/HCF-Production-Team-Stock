/**
 * Asset repair state, read from the asset-detail LAYOUT loader.
 *
 * `hasOpenRepair` is produced once by `routes/_layout+/assets.$assetId.tsx`
 * (one nested `repairs` select on a query it already runs) and read back here
 * by any child route or component that needs it — the Overview panels, the
 * Actions menu, the header badge. One loader, no duplication and no second
 * query per surface (`design.md` §11 item 8).
 *
 * Returns `false` when called outside the asset-detail route tree rather than
 * throwing: a caller that has no repair context legitimately has no open
 * repair, and a hook that explodes off-route is worse than one that degrades.
 *
 * @see {@link file://./../routes/_layout+/assets.$assetId.tsx}
 */

import { useRouteLoaderData } from "react-router";
import type { loader as assetLayoutLoader } from "~/routes/_layout+/assets.$assetId";

/**
 * Route id of the asset-detail layout route. Mirrors the on-disk path minus
 * the extension, which is how react-router's file-based routing names it.
 */
const ASSET_DETAIL_ROUTE_ID = "routes/_layout+/assets.$assetId";

/**
 * Does the asset currently being viewed have an open fault report?
 *
 * @returns `true` when the asset has an `AssetRepair` row with
 *   `closedAt IS NULL`; `false` when it does not, or when called outside the
 *   asset-detail route tree
 */
export function useAssetHasOpenRepair(): boolean {
  const data = useRouteLoaderData<typeof assetLayoutLoader>(
    ASSET_DETAIL_ROUTE_ID
  );

  return data?.hasOpenRepair ?? false;
}

/**
 * The id of the asset's OPEN fault report, for the close POST URL (US-005).
 *
 * Read from the SAME `repairs` select that produces `hasOpenRepair` — the
 * layout loader already fetches the row (`take: 1`, `select: { id }`), so this
 * costs nothing extra and needs no contract change. `take: 1` is sufficient
 * because the partial unique index guarantees at most one open repair per
 * asset.
 *
 * ⚠️ This is the id of an **open** repair only. Once US-008 lands `outcome`, a
 * written-off repair will also have `closedAt IS NULL` and so will surface
 * here — `design.md` §11 item 10 is the loader change that lets the page tell
 * the two apart. Until then, "open" and "not written off" are the same thing.
 *
 * @returns The open repair's id, or `null` when the asset has none (or when
 *   called outside the asset-detail route tree)
 */
export function useAssetOpenRepairId(): string | null {
  const data = useRouteLoaderData<typeof assetLayoutLoader>(
    ASSET_DETAIL_ROUTE_ID
  );

  return data?.asset?.repairs?.[0]?.id ?? null;
}

/**
 * The asset's fault-history summary — count, the most recent few, and the open
 * repair enriched with its description and reporter (US-004).
 *
 * Produced once by the layout loader (`design.md` §11 item 8, `DECISIONS.md`
 * #223) and read here by the Overview card, the out-of-action panel and the
 * close dialog. No surface re-queries.
 *
 * **`null` means "not permitted", not "no faults".** The layout loader ships it
 * only to callers holding `assetRepair:read` — `OWNER`, `ADMIN` and `BASE`
 * (`DECISIONS.md` #35), never `SELF_SERVICE`, who gets the out-of-action
 * heading and first sentence and no fault detail (`design.md` §6.3). An asset
 * with no faults returns `{ count: 0, recent: [], openRepair: null }` instead,
 * which is how a caller tells the two apart. Also `null` off-route, for the
 * same degrade-don't-throw reason as {@link useAssetHasOpenRepair}.
 *
 * @returns The summary, or `null` when the viewer may not read fault history
 */
export function useAssetRepairSummary() {
  const data = useRouteLoaderData<typeof assetLayoutLoader>(
    ASSET_DETAIL_ROUTE_ID
  );

  return data?.repairSummary ?? null;
}
