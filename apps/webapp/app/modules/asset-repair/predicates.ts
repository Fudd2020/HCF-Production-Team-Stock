/**
 * Asset Repair — the shared "is this asset out of action?" predicates.
 *
 * This module is deliberately **pure and client-safe**: no `db`, no imports
 * from any `*.server` module. It exists because the same predicate has to be
 * expressible in three places that cannot all import a server module:
 *
 *  1. Prisma `where` fragments in services (`HEALTHY_ASSET_WHERE`).
 *  2. Prisma `select` fragments declared in shared field files that are also
 *     reachable from the client module graph — `~/modules/asset/fields.ts`
 *     and `~/modules/kit/types.ts` (`OPEN_REPAIR_SELECT`).
 *  3. React list rows deriving the display boolean from the loaded relation
 *     (`deriveHasOpenRepair`).
 *
 * `~/modules/asset-repair/availability.server` re-exports the two Prisma
 * fragments so existing server imports are unchanged; that module remains the
 * only place the *guards* (which do I/O) live.
 *
 * ## The predicate
 *
 * An asset is out of action while it has an `AssetRepair` row with
 * `closedAt IS NULL`. That single condition is the WHOLE bookability rule
 * (`DECISIONS.md` #31, reaffirmed by #37) — no stage, status or outcome may
 * ever become a second input. Nothing here reads or writes
 * `Asset.availableToBook` (`DECISIONS.md` #22).
 *
 * @see {@link file://./availability.server.ts} the booking guards (I/O)
 * @see {@link file://./../../utils/booking-assets.ts} `isAssetBookable`
 */

/**
 * Nested `select` fragment that answers "does this asset have an open repair?"
 * on an asset row you are already loading — one join, NOT one query per row.
 *
 * ```ts
 * const assets = await tx.asset.findMany({
 *   where: { id: { in: ids }, organizationId },
 *   select: { id: true, title: true, repairs: OPEN_REPAIR_SELECT },
 * });
 * ```
 *
 * `take: 1` because the partial unique index `AssetRepair_assetId_open_key`
 * guarantees at most one open repair per asset — we only need existence.
 *
 * **List surfaces must use this, never a per-row lookup.** The asset index,
 * the pickers and a kit's asset list render many rows; folding the existence
 * check into the `findMany` they already run keeps the query count flat
 * (US-002 "Notes for the technical team").
 */
export const OPEN_REPAIR_SELECT = {
  where: { closedAt: null },
  select: { id: true },
  take: 1,
} as const;

/**
 * Prisma `where` fragment selecting assets that are NOT out of action.
 *
 * Spread into any `Asset` where-clause (picker queries, availability counts) to
 * exclude assets carrying an open repair. Named rather than inlined so the
 * predicate exists in exactly one place — `DECISIONS.md` #31 makes it permanent.
 */
export const HEALTHY_ASSET_WHERE = {
  repairs: { none: { closedAt: null } },
} as const;

/**
 * Shape produced by {@link OPEN_REPAIR_SELECT} on a loaded asset row.
 *
 * `repairs` is **required**, not optional, on purpose: a list surface that
 * forgot to widen its `select` is then a compile error rather than a chip that
 * silently never renders. That mirrors why the server guard refuses to default
 * a missing `repairs` to `[]` (`DECISIONS.md`, 2026-08-10 verification note).
 */
export type AssetWithOpenRepairSelect = {
  repairs: Array<{ id: string }>;
};

/**
 * Derives the display boolean the `AssetStatusBadge` `hasOpenRepair` prop wants
 * from a row loaded with {@link OPEN_REPAIR_SELECT}.
 *
 * The array is already filtered to `closedAt IS NULL` by the select, so
 * non-empty means "out of action". Callers whose row carries a flat
 * `hasOpenRepair` boolean instead (the raw-SQL advanced asset index, which
 * computes it with a `NOT EXISTS`/`EXISTS` sub-select) pass that through
 * directly and do not need this helper.
 *
 * @param asset - An asset row loaded with `repairs: OPEN_REPAIR_SELECT`
 * @returns `true` when the asset has an open (unclosed) repair
 */
export function deriveHasOpenRepair(asset: AssetWithOpenRepairSelect): boolean {
  return asset.repairs.length > 0;
}
