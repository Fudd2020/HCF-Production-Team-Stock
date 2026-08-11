/**
 * Unit tests for the repairs booking guard (US-002).
 *
 * Behaviour under test: which asset ids are reported as out of action, that the
 * refusal is a 400 business error rather than a captured server error, and that
 * the message names the offending items in the conventional shape. The Prisma
 * client is the only thing mocked — there is no internal logic here worth
 * stubbing.
 */

import { beforeEach, describe, expect, it, vitest } from "vitest";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import {
  assertNoOpenRepairs,
  assertNoOpenRepairsInLoadedAssets,
  getOpenRepairAssetIds,
  HEALTHY_ASSET_WHERE,
  OPEN_REPAIR_SELECT,
} from "./availability.server";

// why: the guard's only dependency is the database; everything else it does is
// pure. Mocking Prisma keeps the test to the behaviour we care about.
vitest.mock("~/database/db.server", () => ({
  db: {
    assetRepair: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
  },
}));

const ORG_ID = "org-1";

const findMany = db.assetRepair.findMany as unknown as ReturnType<
  typeof vitest.fn
>;

describe("getOpenRepairAssetIds", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    findMany.mockResolvedValue([]);
  });

  it("returns the asset ids that have an open repair", async () => {
    expect.assertions(1);
    findMany.mockResolvedValue([{ assetId: "asset-2" }]);

    const result = await getOpenRepairAssetIds({
      assetIds: ["asset-1", "asset-2"],
      organizationId: ORG_ID,
    });

    expect(result).toEqual(new Set(["asset-2"]));
  });

  it("does not touch the database for an empty id list", async () => {
    expect.assertions(2);

    const result = await getOpenRepairAssetIds({
      assetIds: [],
      organizationId: ORG_ID,
    });

    // US-002 edge case: an org with no repairs pays nothing on the hot path.
    expect(result.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the caller's organization and to OPEN repairs only", async () => {
    expect.assertions(2);

    await getOpenRepairAssetIds({
      assetIds: ["asset-1"],
      organizationId: ORG_ID,
    });

    const where = findMany.mock.calls[0]?.[0]?.where;
    // AC11: an open repair in another org must never affect this one.
    expect(where.organizationId).toBe(ORG_ID);
    // DECISIONS.md #31: `closedAt IS NULL` is the WHOLE predicate.
    expect(where.closedAt).toBeNull();
  });

  it("runs a single query however many ids are passed", async () => {
    expect.assertions(1);

    await getOpenRepairAssetIds({
      assetIds: Array.from({ length: 250 }, (_, i) => `asset-${i}`),
      organizationId: ORG_ID,
    });

    // The picker renders many rows; a per-row lookup would be an N+1.
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe("assertNoOpenRepairs", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    findMany.mockResolvedValue([]);
  });

  it("passes when nothing is out of action", async () => {
    expect.assertions(1);

    await expect(
      assertNoOpenRepairs({ assetIds: ["asset-1"], organizationId: ORG_ID })
    ).resolves.toBeUndefined();
  });

  it("refuses with an expected 400 that is not captured as a server error", async () => {
    expect.assertions(3);
    findMany.mockResolvedValue([
      { assetId: "asset-1", asset: { title: "Ch 3 handheld" } },
    ]);

    const promise = assertNoOpenRepairs({
      assetIds: ["asset-1"],
      organizationId: ORG_ID,
    });

    await expect(promise).rejects.toBeInstanceOf(ShelfError);
    const thrown = (await promise.catch(
      (cause: ShelfError) => cause
    )) as ShelfError;
    expect(thrown.status).toBe(400);
    // AC9: a business refusal, so it must not land in Sentry.
    expect(thrown.shouldBeCaptured).toBe(false);
  });

  it("names the offending item so the message stands alone on a phone", async () => {
    expect.assertions(1);
    findMany.mockResolvedValue([
      { assetId: "asset-1", asset: { title: "Ch 3 handheld" } },
    ]);

    const thrown = (await assertNoOpenRepairs({
      assetIds: ["asset-1"],
      organizationId: ORG_ID,
    }).catch((cause: ShelfError) => cause)) as ShelfError;

    expect(thrown.message).toContain("Ch 3 handheld");
  });

  it("lists at most three titles then 'and N more'", async () => {
    expect.assertions(3);
    findMany.mockResolvedValue(
      ["A", "B", "C", "D", "E"].map((title, index) => ({
        assetId: `asset-${index}`,
        asset: { title },
      }))
    );

    const thrown = (await assertNoOpenRepairs({
      assetIds: ["asset-0"],
      organizationId: ORG_ID,
    }).catch((cause: ShelfError) => cause)) as ShelfError;

    expect(thrown.message).toContain("A, B, C");
    expect(thrown.message).toContain("and 2 more");
    expect(thrown.message).not.toContain("D");
  });
});

describe("assertNoOpenRepairsInLoadedAssets", () => {
  it("passes when no loaded row carries an open repair", () => {
    expect.assertions(1);

    expect(() =>
      assertNoOpenRepairsInLoadedAssets([
        { title: "Healthy cable", repairs: [] },
      ])
    ).not.toThrow();
  });

  it("refuses, naming the out-of-action rows only", () => {
    expect.assertions(2);

    let thrown: ShelfError | undefined;
    try {
      assertNoOpenRepairsInLoadedAssets([
        { title: "Healthy cable", repairs: [] },
        { title: "Crackly XLR", repairs: [{ id: "repair-1" }] },
      ]);
    } catch (cause) {
      thrown = cause as ShelfError;
    }

    expect(thrown?.message).toContain("Crackly XLR");
    expect(thrown?.message).not.toContain("Healthy cable");
  });
});

describe("the shared Prisma fragments", () => {
  it("selects only open repairs, and only enough to prove existence", () => {
    expect.assertions(2);

    // Existence is all the guard needs — the partial unique index guarantees
    // there is at most one open repair per asset.
    expect(OPEN_REPAIR_SELECT.where).toEqual({ closedAt: null });
    expect(OPEN_REPAIR_SELECT.take).toBe(1);
  });

  it("expresses 'healthy' as having no open repair", () => {
    expect.assertions(1);

    expect(HEALTHY_ASSET_WHERE).toEqual({
      repairs: { none: { closedAt: null } },
    });
  });
});
