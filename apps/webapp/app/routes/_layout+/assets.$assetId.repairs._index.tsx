/**
 * Route — an asset's fault history (US-004, `design.md` §7).
 *
 * `GET /assets/:assetId/repairs` → every fault ever recorded against this ONE
 * asset, most recent first. This is the payoff for `DECISIONS.md` #2: Neil
 * chose individual tracking over a pooled count precisely so that the
 * intermittent cable which keeps going back in the box becomes visible as a
 * pattern rather than as bad luck. Without this screen, individual labelling
 * costs 24 records and 24 labels and buys nothing.
 *
 * **A sibling of the close route, not its parent.** The file is named
 * `…repairs._index.tsx` rather than `…repairs.tsx` so that
 * `assets.$assetId.repairs.$repairId.close.tsx` stays a sibling: naming it
 * `repairs.tsx` would make this component the close route's layout, and every
 * POST to the close URL would then also run this loader's queries.
 *
 * The history rows are **read-only, permanently** (US-004 "out of scope,
 * permanently, not deferred"): there is no edit and no delete, in this route
 * or any future one. Any button that acted on a row would state the opposite —
 * that the record is a live thing rather than the audit trail AC5 makes it.
 *
 * @see {@link file://./../../modules/asset-repair/service.server.ts}
 * @see {@link file://./../../modules/asset-repair/history-state.ts}
 * @see {@link file://./assets.$assetId.reminders.tsx} the shape this copies
 */

import { useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
// why: no `useLoaderData` here — `List` reads this route's loader payload
// itself (the `IndexResponse` contract), so the screen takes no props.
import { data } from "react-router";
import { z } from "zod";

import { RepairStateBadge } from "~/components/asset-repair/repair-state-badge";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { Td, Th } from "~/components/table";
import type { AssetRepairHistoryItem } from "~/modules/asset-repair/service.server";
import { getAssetRepairHistory } from "~/modules/asset-repair/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import {
  error,
  getCurrentSearchParams,
  getParams,
  payload,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/** Upper bound on `per_page`, matching `/repairs` and the reminders index. */
const MAX_PER_PAGE = 100;

/** Fallback page size when the cookie holds nothing usable. */
const DEFAULT_PER_PAGE = 20;

/**
 * Roughly the most characters that fit in the clamped two lines of fault text
 * at this table's width. Above it, the `Show more` toggle is offered.
 */
const CLAMPED_FAULT_MIN_LENGTH = 140;

/**
 * Loads one page of this asset's fault history.
 *
 * **Permission is `assetRepair:read`** — `OWNER`, `ADMIN` and **`BASE`**
 * (`DECISIONS.md` #35: someone who can report a fault needs to see what
 * happened last time, or the same fault is raised over and over).
 *
 * ⚠️ It must NOT be `PermissionEntity.note`. That is what gates the Activity
 * tab, `BASE` holds `note: []`, and reusing it here would leave `BASE` with no
 * fault history at all while every test still passed — #35 silently undone
 * (US-004 Permissions & DoD). AC6's activity feed is a **separate** surface and
 * stays note-gated; this one is not.
 *
 * Org-scoping for the `assetId` from the URL lives in the service, which
 * refuses a foreign asset before reading any repair row and never echoes its
 * title or fault text (AC7).
 *
 * @returns The page of history rows plus the pagination metadata `List` needs
 * @throws {Response} 403 when the caller's role lacks `assetRepair:read`
 * @throws {Response} 400 when the asset is not in the caller's organization
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.assetRepair,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam } = getParamsValues(searchParams);

    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const perPage =
      cookie.perPage >= 1 && cookie.perPage <= MAX_PER_PAGE
        ? cookie.perPage
        : DEFAULT_PER_PAGE;

    /**
     * `getParamsValues` runs the raw param through `Number()`, so `?page=abc`
     * arrives as `NaN` and `?page=-3` arrives negative — both would produce a
     * nonsense `skip`. Normalise to page 1 rather than erroring; a page BEYOND
     * the last is deliberately left alone, returning an empty page with honest
     * totals, exactly as `/repairs` does.
     */
    const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;

    const { items, totalItems } = await getAssetRepairHistory({
      assetId,
      // From the session — never the request.
      organizationId,
      page: safePage,
      perPage,
    });

    const header: HeaderData = { title: "Fault history" };
    const modelName = { singular: "fault", plural: "faults" };

    return payload({
      header,
      modelName,
      items,
      totalItems,
      page: safePage,
      perPage,
      totalPages: Math.ceil(totalItems / perPage),
      // This tab has no search (`design.md` §7) — `List` still expects the key.
      search: null,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

/**
 * Formats "how long it was out of action" for a history row.
 *
 * @param days - Whole days, or `null` where the duration would be a fabricated
 *   statistic (the two write-off states — see `AssetRepairHistoryItem`)
 * @returns A sentence fragment, or `null` when there is nothing honest to say
 */
function formatOutOfAction(days: number | null): string | null {
  if (days === null) {
    return null;
  }

  return days === 0
    ? "Out of action for less than a day"
    : `Out of action for ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * One row of the fault history.
 *
 * Module scope, not defined inside the screen, so its identity is stable
 * across renders (`.claude/rules/react-render-stability.md`).
 *
 * On mobile the `Reported` and `Outcome` columns are hidden and their content
 * repeats as sub-lines under the status chip, so nothing is lost on a phone —
 * which is where a volunteer standing at the rack actually reads this
 * (`design.md` §7 "Mobile").
 */
function RepairHistoryRowContent({ item }: { item: AssetRepairHistoryItem }) {
  const [expanded, setExpanded] = useState(false);

  const outOfAction = formatOutOfAction(item.daysOutOfAction);
  const isLongFault = item.faultDescription.length > CLAMPED_FAULT_MIN_LENGTH;

  return (
    <>
      {/* Fault — the symptom as typed, never rewritten (AC5) */}
      <Td className="w-full max-w-0 whitespace-normal">
        {/*
          `faultDescription` is plain user text rendered AS text. It never goes
          through `MarkdownViewer` on this surface, so the Markdoc rule governs
          note content elsewhere, not this.
        */}
        <div
          className={expanded ? "text-gray-700" : "line-clamp-2 text-gray-700"}
        >
          {item.faultDescription}
        </div>

        {/*
          A visible, focusable toggle rather than a hover card: this text is the
          whole reason someone opened the tab and it has to be reachable on
          touch (`design.md` §6.7 "Long fault text"). The length guard exists
          because `line-clamp-2` only truncates what actually overflows, and a
          "Show more" on a six-word fault is a control that visibly does
          nothing.
        */}
        {isLongFault ? (
          <Button
            type="button"
            variant="link"
            className="mt-1 text-xs"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show less" : "Show more"}
          </Button>
        ) : null}

        {/* Mobile-only echo of the two hidden columns. */}
        <div className="mt-2 text-xs text-gray-500 md:hidden">
          <div>
            {item.reporterName} · <DateS date={item.reportedAt} />
          </div>
          {item.closedAt ? (
            <div>
              {item.closerName} · <DateS date={item.closedAt} />
            </div>
          ) : null}
        </div>
      </Td>

      {/* Status — the one derivation, painted by the one component */}
      <Td className="whitespace-nowrap align-top">
        <RepairStateBadge state={item.state} />
        {item.state === "open" && outOfAction ? (
          <div className="mt-1 text-xs text-gray-500">{outOfAction}</div>
        ) : null}
      </Td>

      {/* Reported — who and when (AC1) */}
      <Td className="hidden whitespace-nowrap align-top md:table-cell">
        <div className="text-gray-900">{item.reporterName}</div>
        <div className="text-xs text-gray-500">
          <DateS date={item.reportedAt} />
        </div>
      </Td>

      {/*
        Outcome — NOT "Closed" (`design.md` §7). With four states that word is
        ambiguous: a reinstated repair is also `closedAt`-closed, so a header
        promising closure would sit above a cell describing a scrapping.
      */}
      <Td className="max-w-64 whitespace-normal align-top">
        {item.closedAt ? (
          <>
            <div className="text-gray-900">{item.closerName}</div>
            <div className="text-xs text-gray-500">
              <DateS date={item.closedAt} />
            </div>
            {outOfAction ? (
              <div className="text-xs text-gray-500">{outOfAction}</div>
            ) : null}
            {item.resolutionNote ? (
              <div className="mt-1 line-clamp-1 text-xs text-gray-600">
                {item.resolutionNote}
              </div>
            ) : null}
          </>
        ) : (
          // An em dash, not an empty cell: the row is not missing data, this
          // repair simply has not ended yet.
          <span className="text-gray-400">—</span>
        )}
      </Td>
    </>
  );
}

/**
 * `/assets/:assetId/repairs` — this item's fault history (US-004).
 *
 * Read-only by design. Ordering is fixed by the contract (most recent first,
 * `id` tiebreak) and the UI deliberately offers no sort: AC8 wants the order
 * deterministic across reloads, and a user-selectable sort would invite the
 * paging instability the tiebreak exists to prevent.
 */
export default function AssetRepairsPage() {
  return (
    <ListContentWrapper className="mb-4">
      <List
        ItemComponent={RepairHistoryRowContent}
        customEmptyStateContent={{
          title: "No faults recorded",
          text: "Nothing has ever gone wrong with this item. Long may it last.",
        }}
        headerChildren={
          <>
            <Th>Fault</Th>
            <Th>Status</Th>
            <Th className="hidden md:table-cell">Reported</Th>
            <Th>Outcome</Th>
          </>
        }
      />
    </ListContentWrapper>
  );
}
