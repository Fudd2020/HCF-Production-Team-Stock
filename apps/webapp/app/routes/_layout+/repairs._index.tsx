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

import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";

import type { HeaderData } from "~/components/layout/header/types";
import { parseRepairListFilter } from "~/modules/asset-repair/schema";
import { getOpenRepairsForOrganization } from "~/modules/asset-repair/service.server";
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
