/**
 * Route — the out-of-action list (US-003).
 *
 * `GET /repairs` → every item in the workspace that currently has an open fault
 * report, longest out of action first. This is the screen someone checks on a
 * Thursday to find out what is broken before Sunday, instead of walking the
 * store room.
 *
 * **Server side only for now.** The loader below is the whole of this file's
 * responsibility; the default export, the table and the bucket switcher
 * (`design.md` §9) belong to `shelf-frontend-dev`. Nothing server-side may be
 * referenced from a non-loader export added later
 * (`.claude/rules/no-server-module-in-route-client-exports.md`).
 *
 * Two things about this loader are easy to get wrong and are pinned by tests:
 *
 * 1. **`organizationId` comes from `requirePermission`, never from the
 *    request.** No search param on this screen can widen the scope (AC5).
 * 2. **Bad input degrades, it never 500s** — an unknown `filter`, a negative or
 *    non-numeric `page` all fall back to the default view (US-003 "invalid
 *    input" edge case, `design.md` §9).
 *
 * @see {@link file://./../../modules/asset-repair/service.server.ts}
 * @see {@link file://./../../modules/asset-repair/schema.ts}
 * @see {@link file://./reminders._index.tsx} the shape this copies
 */

import { useCallback } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useLoaderData, useNavigate } from "react-router";

import { MarkAsRepairedDialog } from "~/components/asset-repair/mark-as-repaired-dialog";
import { RepairFilterTabs } from "~/components/asset-repair/repair-filter-tabs";
import { RepairStateBadge } from "~/components/asset-repair/repair-state-badge";
import { AssetCodeBadge } from "~/components/assets/asset-code-badge";
import { AssetImage } from "~/components/assets/asset-image";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import type { ListItemData } from "~/components/list/list-item";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { Td, Th } from "~/components/table";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { parseRepairListFilter } from "~/modules/asset-repair/schema";
import type { RepairListItem } from "~/modules/asset-repair/service.server";
import { getOpenRepairsForOrganization } from "~/modules/asset-repair/service.server";
import { resolveDisplayCode } from "~/modules/barcode/display";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { error, getCurrentSearchParams, payload } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/** Upper bound on `per_page`, matching the reminders index. */
const MAX_PER_PAGE = 100;

/** Fallback page size when the cookie holds nothing usable. */
const DEFAULT_PER_PAGE = 20;

/**
 * Loads a page of open repairs for the caller's workspace.
 *
 * Permission is `assetRepair:read`, which the matrix grants to `OWNER`,
 * `ADMIN` **and `BASE`** (`DECISIONS.md` #35 — anyone who can report a fault
 * must be able to see whether it has already been reported). `SELF_SERVICE` is
 * refused here, and hiding the navigation entry is decoration, not enforcement
 * (AC8). No new `PermissionAction` is introduced (#50).
 *
 * @returns The page of rows, pagination metadata, the active bucket and the
 *   per-bucket counts the switcher renders
 * @throws {Response} 403 when the caller's role lacks `assetRepair:read` (AC8)
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.assetRepair,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search } = getParamsValues(searchParams);

    /**
     * An unknown or absent `filter` degrades to `awaiting` rather than
     * erroring: the user never sees this param, so a typo in a shared URL must
     * not produce an error page (`design.md` §9). Until US-008 adds the
     * `outcome` column, `awaiting` is the whole set and `written-off` is
     * legitimately empty (`DECISIONS.md` #39).
     */
    const filter = parseRepairListFilter(searchParams.get("filter"));

    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const perPage =
      cookie.perPage >= 1 && cookie.perPage <= MAX_PER_PAGE
        ? cookie.perPage
        : DEFAULT_PER_PAGE;

    /**
     * `getParamsValues` runs the raw param through `Number()`, so `?page=abc`
     * arrives as `NaN` and `?page=-3` arrives negative. Both would produce a
     * nonsense `skip`; normalise to page 1 instead (US-003 "out-of-range page
     * numbers … degrade to the default view rather than 500"). A page BEYOND
     * the last one is deliberately left alone — it returns an empty page with
     * honest totals, which the shared pagination already handles, and clamping
     * it would need the count before the query.
     */
    const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;

    const { items, totalItems, counts } = await getOpenRepairsForOrganization({
      // From the session — never the request (AC5).
      organizationId,
      page: safePage,
      perPage,
      search,
      filter,
    });

    const header: HeaderData = { title: "Repairs" };
    const modelName = { singular: "repair", plural: "repairs" };

    return payload({
      header,
      modelName,
      items,
      totalItems,
      page: safePage,
      perPage,
      totalPages: Math.ceil(totalItems / perPage),
      search,
      filter,
      counts,
      searchFieldLabel: "Search repairs",
      searchFieldTooltip: {
        title: "Search repairs",
        text: "Search by item name or fault description. Separate your keywords by a comma(,) to search with OR condition. For example: searching 'mic, crackle' will find repairs matching any of these terms.",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

/**
 * One row of the out-of-action list.
 *
 * Module scope, not defined inside the screen, so its identity is stable across
 * renders (`.claude/rules/react-render-stability.md`).
 *
 * `faultDescription` is **plain user text and is rendered as text** — it never
 * goes through `MarkdownViewer` on this surface, so the Markdoc sanitisation
 * rule does not apply here (it governs note *content*, which this is not).
 */
function RepairListItemContent({
  item,
  canClose,
}: {
  item: RepairListItem;
  canClose: boolean;
}) {
  const currentOrganization = useCurrentOrganization();

  const displayCode = currentOrganization
    ? resolveDisplayCode({
        entity: item.assetCode,
        organization: currentOrganization,
      })
    : null;

  return (
    <>
      {/* Item — image, title, code chip */}
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex items-center gap-3 p-4 md:px-6">
          <AssetImage
            asset={{
              id: item.assetId,
              mainImage: item.assetMainImage,
              thumbnailImage: item.assetThumbnailImage,
              mainImageExpiration: null,
            }}
            alt={`Image of ${item.assetTitle}`}
            className="size-10 shrink-0 rounded border object-cover"
            useThumbnail
          />
          <div className="min-w-0">
            <Button
              to={`/assets/${item.assetId}/overview`}
              variant="link-gray"
              className="block truncate text-left font-medium"
            >
              {item.assetTitle}
            </Button>
            {displayCode ? <AssetCodeBadge {...displayCode} /> : null}
          </div>
        </div>
      </Td>

      {/* Fault as reported */}
      <Td className="max-w-72 whitespace-normal text-gray-600">
        {item.faultDescription}
      </Td>

      {/* Status — the chip, plus how long it has been down */}
      <Td className="whitespace-nowrap">
        {/*
          US-008: painted by the SHARED state component, not a hardcoded chip.
          Before this story every row on this screen was open, so a literal "In
          repair" badge was true; now the `all` bucket mixes written-off rows in
          and a fixed chip would label scrapped gear as awaiting repair — the
          one thing it will never be (`design.md` §17.4, `DECISIONS.md` #51).
        */}
        <RepairStateBadge state={item.isWrittenOff ? "written-off" : "open"} />
        {/*
          The age is meaningful for something still waiting on someone. On a
          written-off row it would read as a repair that has run late, which it
          is not.
        */}
        {item.isWrittenOff ? null : (
          <div className="mt-1 text-xs text-gray-500">
            {item.daysOutOfAction === 0
              ? "Out of action since today"
              : `Out of action for ${item.daysOutOfAction} ${
                  item.daysOutOfAction === 1 ? "day" : "days"
                }`}
          </div>
        )}
      </Td>

      {/* Reported — who and when, then the row action */}
      <Td className="whitespace-nowrap">
        <div className="text-gray-900">{item.reporterName}</div>
        <div className="text-xs text-gray-500">
          <DateS date={item.reportedAt} />
        </div>
        {/*
          A written-off repair cannot be closed — US-005 refuses it server-side
          (#38), and offering a button that always fails is worse than offering
          none (`design.md` §6.3).
        */}
        {canClose && !item.isWrittenOff ? (
          <div className="mt-2">
            <MarkAsRepairedDialog
              assetId={item.assetId}
              repairId={item.id}
              assetTitle={item.assetTitle}
            />
          </div>
        ) : null}
      </Td>
    </>
  );
}

/**
 * `/repairs` — everything that is out of action right now (US-003).
 *
 * The screen someone checks before a service, instead of rummaging through the
 * store room. Rows navigate to the faulty asset; leads can close a repair
 * without leaving the list, which is why the close is a fetcher dialog rather
 * than a route that redirects (`DECISIONS.md` #182).
 */
export default function RepairsIndexPage() {
  const { filter, counts } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { isBaseOrSelfService } = useUserRoleHelper();

  /**
   * Stable identity — a new function each render would remount every row
   * (`.claude/rules/react-render-stability.md`).
   */
  const handleRowNavigate = useCallback(
    (_id: string, item: ListItemData) =>
      navigate(
        `/assets/${(item as unknown as RepairListItem).assetId}/overview`
      ),
    [navigate]
  );

  return (
    <ListContentWrapper>
      <Filters
        slots={{
          "left-of-search": (
            <RepairFilterTabs active={filter} counts={counts} />
          ),
        }}
      />
      <List
        ItemComponent={RepairListItemContent}
        navigate={handleRowNavigate}
        // why: `canClose` is cosmetic only — the action re-checks
        // `assetRepair:update` server-side. BASE may READ this list
        // (`DECISIONS.md` #35) but may not close a repair (#12).
        extraItemComponentProps={{ canClose: !isBaseOrSelfService }}
        customEmptyStateContent={{
          title: "Nothing is out of action",
          text: "When someone reports a fault, the item comes out of the bookable pool and appears here until it is repaired.",
        }}
        headerChildren={
          <>
            <Th>Fault</Th>
            <Th>Status</Th>
            <Th>Reported</Th>
          </>
        }
      />
    </ListContentWrapper>
  );
}
