/**
 * Route tests for `GET /api/labels/get-items-for-print` (US-001).
 *
 * What these cover that a component test cannot:
 *   - **org-scoping is server-side** (AC9) — ids from the request are never
 *     trusted on their own
 *   - **select-all honours the live filters** (AC7) rather than passing the
 *     sentinel through as if it were an id
 *   - **kits resolve from the kit table** (AC8), which is the whole reason this
 *     endpoint exists rather than reusing the asset-only QR download
 *   - **an item with no QR is skipped and counted, never created** — this is a
 *     GET, and a loader that writes is a bug even when the write looks helpful
 *   - the ceiling refuses rather than melting the printer queue (AC10)
 *
 * ## Mocking policy
 *
 * Prisma and `generateCode` are stubbed — the former because these are guard
 * tests, the latter because it shells out to `sharp` and produces a PNG we
 * would only assert is a string. The where-clause builders are left REAL: what
 * they produce is the thing under test.
 *
 * @see {@link file://../../../app/routes/api+/labels.get-items-for-print.ts}
 */

import { createLoaderArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "~/routes/api+/labels.get-items-for-print";
import { ShelfError } from "~/utils/error";
import { MAX_LABELS_PER_PRINT } from "~/utils/label-sheets";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

const dbMocks = vi.hoisted(() => ({
  assetFindMany: vi.fn(),
  kitFindMany: vi.fn(),
  qrFindMany: vi.fn(),
}));

// why: guard tests — the queries' shapes are the assertions, not their results.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findMany: dbMocks.assetFindMany },
    kit: { findMany: dbMocks.kitFindMany },
    qr: { findMany: dbMocks.qrFindMany },
  },
}));

// why: an auth boundary, and stubbing it is what lets a test drive the role.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the real one runs `sharp` to transcode a GIF; irrelevant here and slow.
vi.mock("~/modules/qr/utils.server", () => ({
  generateCode: vi.fn(async () => ({
    sizes: {},
    code: { id: "qr-1", src: "data:image/png;base64,AAA", size: "large" },
  })),
}));

type MockFn = ReturnType<typeof vi.fn>;

const requirePermissionMock = requirePermission as unknown as MockFn;

const ORG_ID = "org-1";
const USER_ID = "user-1";

const mockContext = {
  getSession: () => ({ userId: USER_ID }),
  appVersion: "1.0.0",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as unknown as Parameters<typeof loader>[0]["context"];

/** Calls the loader with a query string. */
function runLoader(query: string) {
  return loader(
    createLoaderArgs({
      context: mockContext,
      request: new Request(
        `http://localhost/api/labels/get-items-for-print?${query}`
      ),
    })
  );
}

/**
 * Reads the JSON body off whatever the loader returned.
 *
 * `data()` wraps the payload, so the body is reachable through the returned
 * object's `data` property in tests rather than over the wire.
 */
function bodyOf(result: unknown) {
  return (result as { data: Record<string, unknown> }).data;
}

function statusOf(result: unknown) {
  return (result as { init?: ResponseInit }).init?.status;
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue({
    organizationId: ORG_ID,
    currentOrganization: { qrIdDisplayPreference: "QR_ID" },
  });
  dbMocks.assetFindMany.mockResolvedValue([]);
  dbMocks.kitFindMany.mockResolvedValue([]);
  dbMocks.qrFindMany.mockResolvedValue([]);
});

describe("print labels endpoint", () => {
  it("gates on qr:READ — the same grant the list itself needs", async () => {
    expect.assertions(1);

    await runLoader("entity=asset&ids=asset-1");

    /**
     * Printing a label discloses nothing the index does not already show, so
     * this deliberately is NOT `asset:update`. Tightening it would stop a BASE
     * volunteer printing a replacement label for gear they can already see.
     */
    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.qr,
        action: PermissionAction.read,
      })
    );
  });

  it("refuses a role without the grant, querying nothing", async () => {
    expect.assertions(3);
    requirePermissionMock.mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "No permission",
        status: 403,
        label: "QR",
      })
    );

    const result = await runLoader("entity=asset&ids=asset-1");

    expect(statusOf(result)).toBe(403);
    expect(dbMocks.assetFindMany).not.toHaveBeenCalled();
    expect(dbMocks.qrFindMany).not.toHaveBeenCalled();
  });

  it("scopes explicit ids to the session's organisation (AC9)", async () => {
    expect.assertions(2);

    await runLoader("entity=asset&ids=asset-1&ids=asset-2");

    /**
     * The ids come from the request, so they are paired WITH `organizationId`
     * rather than trusted alone — an id belonging to another workspace then
     * matches no row instead of printing that workspace's label.
     */
    const where = dbMocks.assetFindMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe(ORG_ID);
    expect(where.id).toEqual({ in: ["asset-1", "asset-2"] });
  });

  it("resolves select-all through the filters, not the sentinel (AC7)", async () => {
    expect.assertions(3);

    await runLoader(`entity=asset&ids=${ALL_SELECTED_KEY}&category=cat-1`);

    const where = dbMocks.assetFindMany.mock.calls[0][0].where;
    // The sentinel is a marker, never an id to look up.
    expect(where.id).toBeUndefined();
    expect(where.organizationId).toBe(ORG_ID);
    // And the live filter reached the query, so "select all" means "all of
    // what I am looking at" rather than the whole workspace.
    expect(JSON.stringify(where)).toContain("cat-1");
  });

  it("resolves kits from the kit table, never the asset table (AC8)", async () => {
    expect.assertions(4);
    dbMocks.kitFindMany.mockResolvedValue([{ id: "kit-1", name: "Drum kit" }]);
    dbMocks.qrFindMany.mockResolvedValue([
      {
        id: "qr-1",
        version: 0,
        errorCorrection: "L",
        assetId: null,
        kitId: "kit-1",
      },
    ]);

    const result = await runLoader("entity=kit&ids=kit-1");

    expect(dbMocks.assetFindMany).not.toHaveBeenCalled();
    expect(dbMocks.kitFindMany).toHaveBeenCalled();

    const body = bodyOf(result) as { items: Array<Record<string, unknown>> };
    // A kit's `name` becomes the label's `title`, so the renderer needs no
    // per-entity branch.
    expect(body.items[0].title).toBe("Drum kit");
    // Kits have no `sequentialId` column, so they always fall back to the QR id.
    expect(body.items[0].sequentialId).toBeNull();
  });

  it("looks up kit QRs by kitId — an assetId lookup would find nothing", async () => {
    expect.assertions(1);
    dbMocks.kitFindMany.mockResolvedValue([{ id: "kit-1", name: "Drum kit" }]);

    await runLoader("entity=kit&ids=kit-1");

    expect(dbMocks.qrFindMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG_ID,
      kitId: { in: ["kit-1"] },
    });
  });

  it("skips an item with no QR and reports it, rather than printing blank", async () => {
    expect.assertions(3);
    dbMocks.assetFindMany.mockResolvedValue([
      { id: "asset-1", title: "Has a QR", sequentialId: "SAM-1" },
      { id: "asset-2", title: "Has none", sequentialId: "SAM-2" },
    ]);
    dbMocks.qrFindMany.mockResolvedValue([
      {
        id: "qr-1",
        version: 0,
        errorCorrection: "L",
        assetId: "asset-1",
        kitId: null,
      },
    ]);

    const result = await runLoader("entity=asset&ids=asset-1&ids=asset-2");
    const body = bodyOf(result) as {
      items: Array<{ id: string }>;
      skippedCount: number;
    };

    /**
     * A blank sticker on a real sheet of stationery is worse than a shorter
     * sheet: it is silently wasted and looks like a bug in the QR code.
     */
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("asset-1");
    expect(body.skippedCount).toBe(1);
  });

  it("prints the OLDEST QR when an item has more than one", async () => {
    expect.assertions(1);
    dbMocks.assetFindMany.mockResolvedValue([
      { id: "asset-1", title: "Relinked", sequentialId: null },
    ]);
    // `orderBy: createdAt asc` in the route means the first row here is the
    // oldest; a relink leaves the superseded row behind.
    dbMocks.qrFindMany.mockResolvedValue([
      {
        id: "qr-old",
        version: 0,
        errorCorrection: "L",
        assetId: "asset-1",
        kitId: null,
      },
      {
        id: "qr-new",
        version: 0,
        errorCorrection: "L",
        assetId: "asset-1",
        kitId: null,
      },
    ]);

    await runLoader("entity=asset&ids=asset-1");

    /**
     * The oldest QR is the one already stuck to the item, so a reprint has to
     * match it — otherwise a replacement label silently stops resolving to the
     * sticker beside it.
     */
    const { generateCode } = await import("~/modules/qr/utils.server");
    expect((generateCode as unknown as MockFn).mock.calls[0][0].qr).toEqual({
      id: "qr-old",
    });
  });

  it("refuses more than the ceiling rather than trying (AC10)", async () => {
    expect.assertions(2);
    dbMocks.assetFindMany.mockResolvedValue(
      Array.from({ length: MAX_LABELS_PER_PRINT + 1 }, (_, index) => ({
        id: `asset-${index}`,
        title: `Asset ${index}`,
        sequentialId: null,
      }))
    );

    const result = await runLoader(`entity=asset&ids=${ALL_SELECTED_KEY}`);

    expect(statusOf(result)).toBe(400);
    // Nothing was generated — the refusal happens before the expensive part.
    expect(dbMocks.qrFindMany).not.toHaveBeenCalled();
  });

  it("refuses an empty selection", async () => {
    expect.assertions(2);

    const result = await runLoader("entity=asset");

    expect(statusOf(result)).toBe(400);
    expect(dbMocks.assetFindMany).not.toHaveBeenCalled();
  });

  it("refuses an unknown entity rather than defaulting to assets", async () => {
    expect.assertions(3);

    const result = await runLoader("entity=booking&ids=booking-1");

    /**
     * Defaulting would be the tempting kindness and the wrong one: a typo'd
     * entity would silently print asset labels for ids that are not assets.
     *
     * **400, not 500.** A bare `schema.parse` throws a `ZodError` that
     * `makeShelfError` cannot classify, producing a captured 500 — so a
     * mistyped query param would page someone. `parseData` is what keeps this
     * a client error.
     */
    expect(statusOf(result)).toBe(400);
    expect(dbMocks.assetFindMany).not.toHaveBeenCalled();
    expect(dbMocks.kitFindMany).not.toHaveBeenCalled();
  });
});
