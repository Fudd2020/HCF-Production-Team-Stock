/**
 * Route tests for `GET /assets/:assetId/repairs` — one asset's fault history
 * (US-004).
 *
 * What these cover that the service-level suite cannot:
 *   - **the permission entity is `assetRepair`, not `note`.** This is the
 *     single most consequential line in the story: `BASE` holds `note: []`, so
 *     gating the history on `note:read` would hide it from exactly the role
 *     `DECISIONS.md` #35 grants it to — and every other test would still pass.
 *     The story's Permissions section and its Definition of Done both call it
 *     out; this is where that is enforced
 *   - `organizationId` comes from the session, so no param can widen it (AC7)
 *   - bad pagination input DEGRADES rather than 500s
 *   - an asset with no faults returns an empty page, never an error (AC4)
 *
 * ## Mocking policy
 *
 * Only the genuine IO boundaries are stubbed: Prisma and the auth/session
 * resolution. `getAssetRepairHistory`, `resolveRepairHistoryState` and the
 * pagination normalisation all run for real, so a scoping or state-derivation
 * regression fails these tests rather than passing through a mock of itself.
 *
 * ⚠️ Lives under `test/routes-tests/` mirroring the route path, and imports the
 * route through the `~/routes/...` alias
 * (`.claude/rules/no-test-files-in-app-routes.md`).
 *
 * @see {@link file://../../../app/routes/_layout+/assets.$assetId.repairs._index.tsx}
 */

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createLoaderArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { hasPermission } from "~/utils/permissions/permission.validator.server";
import { loader } from "~/routes/_layout+/assets.$assetId.repairs._index";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: Prisma is the loader's only real IO dependency. `asset.findMany` is
// there for the shared org guard, which is deliberately NOT stubbed out.
vi.mock("~/database/db.server", () => ({
  db: {
    // `findMany` for the shared org guard; `findFirst` for the asset title the
    // manage dialog's subtitle needs (US-008).
    asset: { findMany: vi.fn(), findFirst: vi.fn() },
    assetRepair: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

// why: US-008 resolves `canManage` (assetRepair:update) server-side so the
// control cannot be shown by a client that guesses. An auth boundary, stubbed.
vi.mock("~/utils/permissions/permission.validator.server", () => ({
  hasPermission: vi.fn(),
}));

// why: `requirePermission` resolves the session and the active workspace — an
// auth boundary, not logic under test. Stubbing it is also what lets a test
// drive `organizationId`, which is the whole point of the cross-org case.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

const ORG_ID = "org-1";
const USER_ID = "user-1";
const ASSET_ID = "asset-1";

type MockFn = ReturnType<typeof vi.fn>;

const assetFindMany = db.asset.findMany as unknown as MockFn;
const assetFindFirst = db.asset.findFirst as unknown as MockFn;
const hasPermissionMock = hasPermission as unknown as MockFn;
const repairFindMany = db.assetRepair.findMany as unknown as MockFn;
const repairCount = db.assetRepair.count as unknown as MockFn;
const requirePermissionMock = requirePermission as unknown as MockFn;

const mockContext = {
  getSession: () => ({ userId: USER_ID }),
  appVersion: "1.0.0",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as unknown as Parameters<typeof loader>[0]["context"];

/** One repair row shaped as the history `select` returns it. */
const REPAIR_ROW = {
  id: "repair-1",
  faultDescription: "Crackles when the cable is moved",
  reportedAt: new Date("2026-08-01T09:00:00.000Z"),
  reporterSnapshot: null,
  reportedBy: { firstName: "Sam", lastName: "Whitfield", displayName: null },
  closedAt: null,
  closerSnapshot: null,
  closedBy: null,
  resolutionNote: null,
};

/** Runs the loader against the tab's URL with the given query string. */
function runLoader(search = "") {
  return loader(
    createLoaderArgs({
      context: mockContext,
      params: { assetId: ASSET_ID },
      request: new Request(
        `http://localhost/assets/${ASSET_ID}/repairs${search}`
      ),
    })
  );
}

/** The `where` the history query ran with. */
function historyWhere(): Record<string, unknown> {
  return (repairFindMany.mock.calls[0]?.[0]?.where ?? {}) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  vi.clearAllMocks();

  requirePermissionMock.mockResolvedValue({
    organizationId: ORG_ID,
    role: "ADMIN",
  });
  assetFindMany.mockResolvedValue([{ id: ASSET_ID }]);
  assetFindFirst.mockResolvedValue({ title: "Ch 3 handheld radio mic" });
  hasPermissionMock.mockResolvedValue(true);
  repairFindMany.mockResolvedValue([REPAIR_ROW]);
  repairCount.mockResolvedValue(1);
});

describe("asset repairs tab loader", () => {
  it("gates on assetRepair:read — NOT on note:read", async () => {
    expect.assertions(2);

    await runLoader();

    /**
     * The one-word mistake with a policy-sized consequence. `BASE` holds
     * `note: []` and `assetRepair: [read]`, so gating this on `note` would
     * leave `BASE` with no fault history at all while `DECISIONS.md` #35 said
     * they had it — and the suite would stay green. AC6's activity feed is a
     * separate surface and stays note-gated; this one is not.
     */
    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.assetRepair,
        action: PermissionAction.read,
      })
    );
    expect(requirePermissionMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ entity: PermissionEntity.note })
    );
  });

  it("refuses a role without the grant, and reads nothing first", async () => {
    expect.assertions(2);
    requirePermissionMock.mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You don't have permission to view this item's fault history.",
        status: 403,
        label: "Permission",
      })
    );

    const thrown = await runLoader().catch((cause: unknown) => cause);

    assertIsDataWithResponseInit(thrown);
    expect(thrown.init?.status).toBe(403);
    expect(repairFindMany).not.toHaveBeenCalled();
  });

  it("scopes the history with the session's organisation, not the request's", async () => {
    expect.assertions(2);

    // A crafted param must not reach the query (AC7).
    await runLoader("?organizationId=org-2");

    expect(historyWhere().organizationId).toBe(ORG_ID);
    expect(historyWhere().assetId).toBe(ASSET_ID);
  });

  it("refuses an asset from another workspace without disclosing it", async () => {
    expect.assertions(2);
    /**
     * Org-scoped twice: the title lookup is itself `where: { id,
     * organizationId }`, so a foreign asset resolves to nothing and is refused
     * there — before the shared guard, and long before any repair row is read.
     */
    assetFindFirst.mockResolvedValue(null);
    assetFindMany.mockResolvedValue([]);

    const thrown = await runLoader().catch((cause: unknown) => cause);

    assertIsDataWithResponseInit(thrown);
    expect(thrown.init?.status).toBe(404);
    // No fault text, reporter name or title from the other org can leak.
    expect(repairFindMany).not.toHaveBeenCalled();
  });

  it("normalises junk pagination to the first page rather than erroring", async () => {
    expect.assertions(2);

    const result = await runLoader("?page=not-a-number");

    expect(result.page).toBe(1);
    expect(repairFindMany.mock.calls[0]?.[0]?.skip).toBe(0);
  });

  it("normalises a negative page the same way", async () => {
    expect.assertions(1);

    const result = await runLoader("?page=-4");

    expect(result.page).toBe(1);
  });

  it("ships the rows with their derived state, ready to render", async () => {
    expect.assertions(3);

    const result = await runLoader();

    expect(result.items).toHaveLength(1);
    // Derived by the one named helper, server-side (AC9) — a component that
    // re-derived this from `closedAt` would be the drift the AC forbids.
    expect(result.items[0].state).toBe("open");
    expect(result.items[0].reporterName).toBe("Sam Whitfield");
  });

  it("returns an empty page for an asset that has never had a fault", async () => {
    expect.assertions(3);
    repairFindMany.mockResolvedValue([]);
    repairCount.mockResolvedValue(0);

    const result = await runLoader();

    // AC4: the screen renders its empty state; the loader does not error and
    // does not pretend there is a page of nothing.
    expect(result.items).toEqual([]);
    expect(result.totalItems).toBe(0);
    expect(result.totalPages).toBe(0);
  });
});
