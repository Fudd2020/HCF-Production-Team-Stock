/**
 * Route tests for `GET /repairs` — the out-of-action list (US-003).
 *
 * What these cover that the service-level suite cannot:
 *   - the permission gate is `assetRepair:read`, which the matrix grants to
 *     `OWNER`, `ADMIN` and `BASE` and refuses `SELF_SERVICE` (AC8,
 *     `DECISIONS.md` #35). Hiding the nav entry is decoration; this is the
 *     enforcement
 *   - `organizationId` comes from the session, and no search param on this
 *     screen can widen it (AC5)
 *   - bad input DEGRADES rather than 500s: an unknown `filter` falls back to
 *     `awaiting`, and a junk or negative `page` falls back to page 1
 *   - the `filter` param ships from day one as a working no-op — `written-off`
 *     is empty and no query names the `outcome` column US-008 will add (AC10)
 *
 * ## Mocking policy
 *
 * Only the genuine IO boundaries are stubbed: Prisma and the auth/session
 * resolution. `getOpenRepairsForOrganization`, `parseRepairListFilter` and the
 * pagination helpers all run for real, so a scoping or degradation regression
 * fails these tests rather than passing through a mock of itself.
 *
 * ⚠️ Lives under `test/routes-tests/` mirroring the route path, and imports the
 * route through the `~/routes/...` alias
 * (`.claude/rules/no-test-files-in-app-routes.md`).
 *
 * @see {@link file://../../../app/routes/_layout+/repairs._index.tsx}
 * @see {@link file://../../../app/modules/asset-repair/service.server.ts}
 */

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createLoaderArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { loader } from "~/routes/_layout+/repairs._index";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: Prisma is the loader's only real IO dependency. The service, the filter
// parser and the pagination normalisation are the behaviour under test and are
// deliberately NOT stubbed.
vi.mock("~/database/db.server", () => ({
  db: {
    assetRepair: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

// why: `requirePermission` resolves the session and the active workspace — an
// auth boundary, not logic under test. Stubbing it is also what lets a test
// drive `organizationId`, which is the whole point of the cross-org case.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

const ORG_ID = "org-1";
const USER_ID = "user-1";

type MockFn = ReturnType<typeof vi.fn>;

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

/** One repair row shaped as the service's `select` returns it. */
const REPAIR_ROW = {
  id: "repair-1",
  assetId: "asset-1",
  faultDescription: "Crackles when the cable is moved",
  reportedAt: new Date("2026-08-01T09:00:00.000Z"),
  reporterSnapshot: null,
  reportedBy: { firstName: "Sam", lastName: "Whitfield", displayName: null },
  asset: {
    title: "Ch 3 handheld radio mic",
    mainImage: "main.jpg",
    thumbnailImage: "thumb.jpg",
    sequentialId: "SAM-0124",
    preferredBarcodeId: null,
    qrCodes: [{ id: "qr-1" }],
    barcodes: [],
  },
};

/** Runs the loader against a `/repairs` URL with the given query string. */
function runLoader(search = "") {
  return loader(
    createLoaderArgs({
      context: mockContext,
      request: new Request(`http://localhost/repairs${search}`),
    })
  );
}

/** The `where` the row query ran with. */
function listWhere(): Record<string, unknown> {
  return (repairFindMany.mock.calls[0]?.[0]?.where ?? {}) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  vi.clearAllMocks();

  requirePermissionMock.mockResolvedValue({ organizationId: ORG_ID });
  repairFindMany.mockResolvedValue([REPAIR_ROW]);
  repairCount.mockResolvedValue(1);
});

describe("repairs index loader", () => {
  it("requires assetRepair:read — the grant BASE also holds", async () => {
    expect.assertions(1);

    await runLoader();

    // AC8 / `DECISIONS.md` #35 + #50: reuse the existing entity's `read`
    // action. `SELF_SERVICE` holds `assetRepair: []`, so this call is what
    // refuses them; the missing nav entry is not the enforcement.
    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.assetRepair,
        action: PermissionAction.read,
      })
    );
  });

  it("refuses a role without the grant, with its own status", async () => {
    expect.assertions(2);
    requirePermissionMock.mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You don't have permission to view repairs.",
        status: 403,
        label: "Permission",
      })
    );

    const thrown = await runLoader().catch((cause: unknown) => cause);

    assertIsDataWithResponseInit(thrown);
    expect(thrown.init?.status).toBe(403);
    // Nothing was read before the gate.
    expect(repairFindMany).not.toHaveBeenCalled();
  });

  it("scopes the list with the session's organisation, not the request's", async () => {
    expect.assertions(2);

    // A crafted param must not reach the query — `organizationId` is only ever
    // the one `requirePermission` resolved (AC5).
    await runLoader("?organizationId=org-2&s=mic");

    expect(listWhere().organizationId).toBe(ORG_ID);
    expect(listWhere().closedAt).toBeNull();
  });

  it("degrades an unknown filter to the awaiting bucket instead of erroring", async () => {
    expect.assertions(2);

    const result = await runLoader("?filter=written%20off%20maybe");

    // `design.md` §9: the user never sees this param, so a typo in a shared
    // URL must not produce an error page.
    expect(result.filter).toBe("awaiting");
    expect(result.items).toHaveLength(1);
  });

  it("honours the written-off bucket, on the real outcome column", async () => {
    expect.assertions(3);
    repairFindMany.mockResolvedValue([]);
    repairCount.mockResolvedValue(0);

    const result = await runLoader("?filter=written-off");

    /**
     * AC10 / `DECISIONS.md` #39. The param shipped from day one as a working
     * no-op precisely so US-008 changed ONE `where` fragment rather than this
     * loader and the screen as well — and this assertion is the proof that it
     * did: the route is untouched, only the predicate underneath it moved.
     */
    expect(result.filter).toBe("written-off");
    expect(result.items).toEqual([]);
    // Was `not.toHaveProperty` until US-008 added the column.
    expect(listWhere().outcome).toEqual({ not: null });
  });

  it("degrades a junk page number to the first page", async () => {
    expect.assertions(2);

    const result = await runLoader("?page=not-a-number");

    // `getParamsValues` runs the raw param through `Number()`, so this arrives
    // as NaN and would otherwise produce `skip: NaN`.
    expect(result.page).toBe(1);
    expect(repairFindMany.mock.calls[0][0].skip).toBe(0);
  });

  it("degrades a negative page number to the first page", async () => {
    expect.assertions(2);

    const result = await runLoader("?page=-3");

    expect(result.page).toBe(1);
    expect(repairFindMany.mock.calls[0][0].skip).toBe(0);
  });

  it("returns the pagination and bucket counts the screen renders", async () => {
    expect.assertions(5);
    repairCount.mockResolvedValue(7);

    const result = await runLoader("?page=2");

    expect(result.page).toBe(2);
    expect(result.perPage).toBe(20);
    expect(result.totalItems).toBe(7);
    expect(result.totalPages).toBe(1);
    // The switcher labels — `Awaiting repair (7)` / `Written off (7)` here
    // only because the count mock is flat; the split is pinned in the service
    // suite, which can tell the two `where` clauses apart.
    expect(result.counts).toEqual({ awaiting: 7, writtenOff: 7 });
  });

  it("passes the search term through to the query", async () => {
    expect.assertions(2);

    const result = await runLoader("?s=mic");

    expect(result.search).toBe("mic");
    expect(listWhere().OR).toHaveLength(1);
  });
});
