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
