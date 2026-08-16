/**
 * Unit tests for the repair write paths — report (US-001) and close (US-005).
 *
 * US-001 covers the acceptance criteria that live in the service rather than in
 * the route: the repair row and its note commit together (AC1/AC6), the note
 * cannot be made to carry an injected Markdoc tag (AC7), a foreign asset id is
 * refused without disclosing the other workspace's data (AC8), a
 * quantity-tracked asset is refused with a capability message (AC9), and the
 * partial unique index's `P2002` becomes a 400 rather than a 500 (AC5).
 *
 * US-005 covers the close: the compare-and-set shape that makes a second close
 * impossible (AC6) and is pinned as a CAS rather than a pre-read, the two
 * refusals being told apart on the failure path only, the non-disclosing 404
 * (AC7), and the resolution note's Markdoc sanitisation (AC10).
 *
 * US-003 covers the out-of-action list: every query is scoped to the session's
 * organisation and to `closedAt IS NULL` and nothing else (AC1/AC5/AC6), the
 * page is one query regardless of how many rows it holds (AC7), the `filter`
 * param ships as a working no-op with the `written-off` bucket empty until
 * US-008 (AC10), and the row carries the age the screen exists to show (AC2).
 */

import Markdoc from "@markdoc/markdoc";
import { AssetType, Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vitest } from "vitest";

import { db } from "~/database/db.server";
import type { ShelfError } from "~/utils/error";

import {
  closeAssetRepair,
  REPAIR_WRITTEN_OFF_MESSAGE,
  transitionRepairStage,
  writeOffRepair,
  reinstateRepair,
  REPAIR_REINSTATE_REFUSED_MESSAGE,
  FAULT_HISTORY_CARD_LIMIT,
  getAssetRepairHistory,
  getAssetRepairSummary,
  getOpenRepairsForOrganization,
  REPAIR_ALREADY_CLOSED_MESSAGE,
  REPAIR_NOT_FOUND_MESSAGE,
  reportAssetFault,
} from "./service.server";

// why: the service's only external dependency is Prisma. Everything else it
// does — org-scoping, sanitisation, note composition — is the behaviour under
// test and is deliberately NOT stubbed, so the real `createNotes` and the real
// Markdoc wrappers run.
vitest.mock("~/database/db.server", () => {
  const tx = {
    asset: {
      findFirst: vitest.fn(),
      findMany: vitest.fn(),
      // Present only so the "never writes availableToBook" test can assert on
      // it. The service must never reach for these.
      update: vitest.fn(),
      updateMany: vitest.fn(),
    },
    user: { findUnique: vitest.fn() },
    assetRepair: {
      create: vitest.fn(),
      // US-005: the close is a compare-and-set (`updateMany`), and `findFirst`
      // must only ever be reached on its FAILURE path.
      updateMany: vitest.fn(),
      findFirst: vitest.fn(),
      // US-003: the out-of-action list — one `findMany` plus the bucket counts.
      findMany: vitest.fn(),
      count: vitest.fn(),
    },
    note: { createMany: vitest.fn() },
    /**
     * why: `reportAssetFault` now calls the POST-COMMIT notification fan-out
     * (US-009 + US-011). That fan-out swallows its own errors, so without these
     * the tests still pass — but every report logs two stack traces, which
     * makes a real failure invisible in the output. Stubbed to the empty case:
     * no leads, no affected bookings, so no email is attempted.
     * The fan-out's own behaviour is tested in `notifications.server.test.ts`.
     */
    organization: { findUnique: vitest.fn() },
    booking: { findMany: vitest.fn() },
    // `getOrganizationAdminsForNotification` reads this.
    userOrganization: { findMany: vitest.fn() },
    // why: `recordEvent` writes the structured audit row through
    // `client.activityEvent.create` inside the same transaction
    // (`.claude/rules/use-record-event.md`). Without this the mock tx has no
    // such model and every write path throws on `undefined.create`.
    activityEvent: { create: vitest.fn() },
  };

  return {
    db: {
      ...tx,
      // why: the service uses the callback form; route it through the same
      // mock object so per-test overrides are visible inside the transaction.
      $transaction: vitest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx)
      ),
    },
  };
});

const ORG_ID = "org-1";
const OTHER_ORG_ID = "org-2";
const USER_ID = "user-1";
const ASSET_ID = "asset-1";

type MockFn = ReturnType<typeof vitest.fn>;

const assetFindFirst = db.asset.findFirst as unknown as MockFn;
const assetFindMany = db.asset.findMany as unknown as MockFn;
const userFindUnique = db.user.findUnique as unknown as MockFn;
const repairCreate = db.assetRepair.create as unknown as MockFn;
const repairUpdateMany = db.assetRepair.updateMany as unknown as MockFn;
const repairFindFirst = db.assetRepair.findFirst as unknown as MockFn;
const repairFindMany = db.assetRepair.findMany as unknown as MockFn;
const repairCount = db.assetRepair.count as unknown as MockFn;
const noteCreateMany = db.note.createMany as unknown as MockFn;
const activityEventCreate = db.activityEvent.create as unknown as MockFn;
const bookingFindMany = db.booking.findMany as unknown as MockFn;

/** The note content the service wrote, as stored. */
function writtenNoteContent(): string {
  return noteCreateMany.mock.calls[0]?.[0]?.data?.[0]?.content ?? "";
}

/** Every Markdoc tag the stored note parses into. */
function tagsIn(content: string): string[] {
  return [...Markdoc.parse(content).walk()]
    .filter((node) => node.type === "tag")
    .map((node) => JSON.stringify(node.attributes));
}

beforeEach(() => {
  vitest.clearAllMocks();

  assetFindFirst.mockResolvedValue({
    id: ASSET_ID,
    title: "Ch 3 handheld radio mic",
    type: AssetType.INDIVIDUAL,
  });
  // Satisfies both `assertAssetsBelongToOrg` calls (the service's own and the
  // one inside `createNotes`).
  assetFindMany.mockResolvedValue([{ id: ASSET_ID }]);
  userFindUnique.mockResolvedValue({
    firstName: "Neil",
    lastName: "Hobson",
    displayName: null,
  });
  repairCreate.mockResolvedValue({ id: "repair-1", assetId: ASSET_ID });
  // The close wins its compare-and-set by default; individual tests override.
  repairUpdateMany.mockResolvedValue({ count: 1 });
  noteCreateMany.mockResolvedValue({ count: 1 });
  // Notification fan-out: nobody to notify, nothing booked (see the mock note).
  (db.organization.findUnique as unknown as MockFn).mockResolvedValue({
    name: "HCF Production",
  });
  (db.booking.findMany as unknown as MockFn).mockResolvedValue([]);
  (db.userOrganization.findMany as unknown as MockFn).mockResolvedValue([]);
  /**
   * File-wide defaults for the US-003 list. Restored here (rather than only
   * inside the list describe) because `clearAllMocks` clears CALLS, not
   * implementations — an override that escaped its suite would fail somebody
   * else's, which is `DECISIONS.md` #139's failure mode.
   */
  repairFindMany.mockResolvedValue([]);
  repairCount.mockResolvedValue(0);
});

describe("reportAssetFault", () => {
  it("creates an open repair recording who reported it and when", async () => {
    expect.assertions(3);

    await reportAssetFault({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      faultDescription: "Crackles when the cable is moved",
    });

    const created = repairCreate.mock.calls[0]?.[0]?.data;
    expect(created.organizationId).toBe(ORG_ID);
    expect(created.reportedById).toBe(USER_ID);
    // Open == `closedAt` never set. The column defaults to NULL; writing it
    // would be the one thing that resurrects a written-off asset later.
    expect(created).not.toHaveProperty("closedAt");
  });

  it("never writes to the asset itself", async () => {
    expect.assertions(2);

    await reportAssetFault({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      faultDescription: "Crackles",
    });

    // DECISIONS.md #22: a repair OVERRIDES `availableToBook` and must never
    // mutate it — suppress-and-restore was rejected precisely because it
    // stores a second source of truth. The same goes for `Asset.status`
    // (#21: the enum is not extended).
    expect(db.asset.update).not.toHaveBeenCalled();
    expect(db.asset.updateMany).not.toHaveBeenCalled();
  });

  it("writes the repair and its note in the same transaction", async () => {
    expect.assertions(2);

    await reportAssetFault({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      faultDescription: "Crackles",
    });

    // AC6: nothing is written if the transaction rolls back, which is only
    // true while both writes go through the same client.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(noteCreateMany).toHaveBeenCalledTimes(1);
  });

  it("stores the fault description in the note", async () => {
    expect.assertions(1);

    await reportAssetFault({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      faultDescription: "Crackles when the cable is moved",
    });

    expect(writtenNoteContent()).toContain("Crackles when the cable is moved");
  });

  it("cannot be made to inject a Markdoc tag through the description", async () => {
    expect.assertions(3);

    const benign = "Crackles when the cable is moved";
    const payload = `{% link to="javascript:alert(document.cookie)" text="x" /%}`;

    await reportAssetFault({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      faultDescription: benign,
    });
    const benignTags = tagsIn(writtenNoteContent());

    noteCreateMany.mockClear();

    await reportAssetFault({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      faultDescription: payload,
    });
    const injectedContent = writtenNoteContent();
    const injectedTags = tagsIn(injectedContent);

    // AC7 asserts on the PARSE, not on a substring: the description must add
    // NO tags beyond the ones the system itself emits (the reporter link).
    expect(injectedTags).toHaveLength(benignTags.length);
    expect(injectedTags.join()).not.toContain("javascript:");
    // The text still shows, literally — the user's report is not silently lost.
    expect(injectedContent).toContain("alert(document.cookie)");
  });

  it("cannot be made to inject a tag by doubling the delimiters", async () => {
    expect.assertions(1);

    await reportAssetFault({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      // A single-pass strip would splice the leftovers into a WORKING tag.
      faultDescription: `{{% link to="javascript:alert(1)" /%}}`,
    });

    expect(tagsIn(writtenNoteContent()).join()).not.toContain("javascript:");
  });

  it("refuses a fault report against a quantity-tracked asset", async () => {
    expect.assertions(3);
    assetFindFirst.mockResolvedValue({
      id: ASSET_ID,
      title: "Gaffa tape",
      type: AssetType.QUANTITY_TRACKED,
    });

    const thrown = (await reportAssetFault({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      faultDescription: "Sticky",
    }).catch((cause: ShelfError) => cause)) as ShelfError;

    expect(thrown.status).toBe(400);
    // DECISIONS.md #23: state a CAPABILITY, never a policy Neil has not set.
    expect(thrown.message).toBe(
      "Fault reports are recorded against individually-tracked assets."
    );
    expect(repairCreate).not.toHaveBeenCalled();
  });

  it("refuses another organisation's asset without disclosing it", async () => {
    expect.assertions(3);
    // Org-scoped read: a foreign id resolves to null, whatever it points at.
    assetFindFirst.mockResolvedValue(null);

    const thrown = (await reportAssetFault({
      assetId: "asset-in-another-org",
      organizationId: OTHER_ORG_ID,
      userId: USER_ID,
      faultDescription: "Broken",
    }).catch((cause: ShelfError) => cause)) as ShelfError;

    expect(thrown.status).toBe(404);
    // AC8: the response must not echo the other workspace's asset title.
    expect(thrown.message).not.toContain("Ch 3 handheld radio mic");
    expect(repairCreate).not.toHaveBeenCalled();
  });

  it("turns the one-open-repair index violation into an actionable 400", async () => {
    expect.assertions(3);
    repairCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: "AssetRepair_assetId_open_key" },
      })
    );

    const thrown = (await reportAssetFault({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      faultDescription: "Crackles",
    }).catch((cause: ShelfError) => cause)) as ShelfError;

    // AC5: two people submitting in the same second — one commits, the other
    // is told why, and it is not a captured server error.
    expect(thrown.status).toBe(400);
    expect(thrown.shouldBeCaptured).toBe(false);
    expect(thrown.message).toContain("already has an open fault report");
  });
});

const REPAIR_ID = "repair-1";

/** The `where` clause the close's compare-and-set ran with. */
function closeWhere(): Record<string, unknown> {
  return repairUpdateMany.mock.calls[0]?.[0]?.where ?? {};
}

/** The `data` the close's compare-and-set wrote. */
function closeData(): Record<string, unknown> {
  return repairUpdateMany.mock.calls[0]?.[0]?.data ?? {};
}

describe("closeAssetRepair", () => {
  it("closes the repair, recording who closed it and when", async () => {
    expect.assertions(4);

    const before = Date.now();

    await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: REPAIR_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      resolutionNote: "Re-terminated the male XLR and tested it",
    });

    // AC1: closed, by whom, when — and the "what was done" note kept with it.
    expect(closeData().closedById).toBe(USER_ID);
    expect((closeData().closedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before
    );
    expect(closeData().resolutionNote).toBe(
      "Re-terminated the male XLR and tested it"
    );
    expect(closeData().closerSnapshot).toMatchObject({
      firstName: "Neil",
      lastName: "Hobson",
    });
  });

  it("closes with an atomic compare-and-set, scoped to the org, the asset and the repair", async () => {
    expect.assertions(4);

    await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: REPAIR_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    // `DECISIONS.md` #25 — `closedAt: null` in the WHERE is what makes closing
    // twice impossible under concurrency (AC6). `organizationId` + `assetId`
    // put the org scope and the asset/repair pairing in the same statement as
    // the write (AC7).
    expect(closeWhere().id).toBe(REPAIR_ID);
    expect(closeWhere().organizationId).toBe(ORG_ID);
    expect(closeWhere().assetId).toBe(ASSET_ID);
    expect(closeWhere().closedAt).toBeNull();
  });

  it("never reads the repair's state before writing", async () => {
    expect.assertions(2);

    await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: REPAIR_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    // The moment a `findFirst` on `AssetRepair` appears on the HAPPY path, the
    // close has become a read-then-write and AC6 is decided by two racing
    // readers instead of by the database. The failure path may read; this one
    // must not (`DECISIONS.md` #25).
    expect(repairFindFirst).not.toHaveBeenCalled();
    expect(repairUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("never writes to the asset itself", async () => {
    expect.assertions(2);

    await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: REPAIR_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    // AC2/AC3 + `DECISIONS.md` #22/#31: stamping `closedAt` IS the return to
    // service. Restoring `availableToBook` would un-park an asset an admin had
    // deliberately parked, and writing `status` would overwrite custody.
    expect(db.asset.update).not.toHaveBeenCalled();
    expect(db.asset.updateMany).not.toHaveBeenCalled();
  });

  it("writes the closure and its note in the same transaction", async () => {
    expect.assertions(2);

    await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: REPAIR_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      resolutionNote: "Re-terminated the male XLR",
    });

    // AC5: the note must not survive a rollback of the closure, which is only
    // true while both writes go through the same client.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(noteCreateMany).toHaveBeenCalledTimes(1);
  });

  it("keeps the resolution note in the activity note when one is given", async () => {
    expect.assertions(2);

    await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: REPAIR_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      resolutionNote: "Re-terminated the male XLR and tested it",
    });

    expect(writtenNoteContent()).toContain("marked this repaired");
    expect(writtenNoteContent()).toContain(
      "Re-terminated the male XLR and tested it"
    );
  });

  it("closes without a note, and stores no empty resolution note", async () => {
    expect.assertions(2);

    await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: REPAIR_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    // An omitted note is explicitly NULL, never `""` — the history renders the
    // difference between "no explanation" and "an empty explanation".
    expect(closeData().resolutionNote).toBeNull();
    expect(writtenNoteContent()).toContain("marked this repaired");
  });

  it("cannot be made to inject a Markdoc tag through the resolution note", async () => {
    expect.assertions(3);

    const benign = "Re-terminated the male XLR";
    const injection = `{% link to="javascript:alert(document.cookie)" text="x" /%}`;

    await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: REPAIR_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      resolutionNote: benign,
    });
    const benignTags = tagsIn(writtenNoteContent());

    noteCreateMany.mockClear();

    await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: REPAIR_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      resolutionNote: injection,
    });
    const injectedContent = writtenNoteContent();
    const injectedTags = tagsIn(injectedContent);

    // AC10 asserts on the PARSE, not on a substring: the note must add NO tags
    // beyond the ones the system itself emits (the closer link).
    expect(injectedTags).toHaveLength(benignTags.length);
    expect(injectedTags.join()).not.toContain("javascript:");
    // The text still shows, literally — what the lead typed is not lost.
    expect(injectedContent).toContain("alert(document.cookie)");
  });

  it("cannot be made to inject a tag by doubling the delimiters", async () => {
    expect.assertions(1);

    await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: REPAIR_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      // A single-pass strip would splice the leftovers into a WORKING tag.
      resolutionNote: `{{% link to="javascript:alert(1)" /%}}`,
    });

    expect(tagsIn(writtenNoteContent()).join()).not.toContain("javascript:");
  });

  it("refuses a second close, and writes nothing", async () => {
    expect.assertions(4);
    // The compare-and-set matched nothing …
    repairUpdateMany.mockResolvedValue({ count: 0 });
    // … because someone else got there first.
    repairFindFirst.mockResolvedValue({
      id: REPAIR_ID,
      assetId: ASSET_ID,
      closedAt: new Date("2026-08-10T09:00:00.000Z"),
    });

    const thrown = (await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: REPAIR_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      resolutionNote: "Re-terminated the male XLR",
    }).catch((cause: ShelfError) => cause)) as ShelfError;

    // AC6: a stale tab, a double-click or a replayed request — an expected
    // business refusal, not a captured application error …
    expect(thrown.status).toBe(400);
    expect(thrown.shouldBeCaptured).toBe(false);
    expect(thrown.message).toBe(REPAIR_ALREADY_CLOSED_MESSAGE);
    // … and no second note (nor, once it exists, a second activity event).
    expect(noteCreateMany).not.toHaveBeenCalled();
  });

  it("refuses another organisation's repair without disclosing it", async () => {
    expect.assertions(4);
    repairUpdateMany.mockResolvedValue({ count: 0 });
    // Org-scoped read on the failure path: a foreign repair id resolves to
    // null, whatever it points at.
    repairFindFirst.mockResolvedValue(null);

    const thrown = (await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: "repair-in-another-org",
      organizationId: ORG_ID,
      userId: USER_ID,
    }).catch((cause: ShelfError) => cause)) as ShelfError;

    expect(thrown.status).toBe(404);
    expect(thrown.message).toBe(REPAIR_NOT_FOUND_MESSAGE);
    // AC7: nothing about the other organisation's asset or fault text.
    expect(thrown.message).not.toContain("Ch 3 handheld radio mic");
    expect(noteCreateMany).not.toHaveBeenCalled();
  });

  it("refuses a repair id that belongs to a different asset", async () => {
    expect.assertions(3);
    repairUpdateMany.mockResolvedValue({ count: 0 });
    repairFindFirst.mockResolvedValue({
      id: REPAIR_ID,
      // Same workspace, different asset — the URL's pair does not exist.
      assetId: "another-asset",
      closedAt: null,
    });

    const thrown = (await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: REPAIR_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
    }).catch((cause: ShelfError) => cause)) as ShelfError;

    // Without the `assetId` condition this pairing would have closed the OTHER
    // asset's repair and filed the note against this one.
    expect(thrown.status).toBe(404);
    expect(thrown.message).toBe(REPAIR_NOT_FOUND_MESSAGE);
    expect(noteCreateMany).not.toHaveBeenCalled();
  });

  it("refuses cleanly when the asset was deleted while in repair", async () => {
    expect.assertions(3);
    // The org-scoped asset read is the same one that produces the AC7 404, so
    // a deleted asset and a foreign asset are indistinguishable by design.
    assetFindFirst.mockResolvedValue(null);

    const thrown = (await closeAssetRepair({
      assetId: ASSET_ID,
      repairId: REPAIR_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
    }).catch((cause: ShelfError) => cause)) as ShelfError;

    expect(thrown.status).toBe(404);
    expect(thrown.message).toBe(REPAIR_NOT_FOUND_MESSAGE);
    expect(repairUpdateMany).not.toHaveBeenCalled();
  });
});

/**
 * A Prisma `where` as the mock received it. `unknown` members rather than
 * `any`, so every assertion below has to narrow before it reads.
 */
type PrismaWhere = Record<string, unknown>;

describe("getOpenRepairsForOrganization", () => {
  /** `2026-08-13T09:00:00Z` — every age assertion below is relative to this. */
  const NOW = new Date("2026-08-13T09:00:00.000Z");

  /**
   * A repair row shaped exactly as the service's `select` returns it.
   *
   * @param overrides - Fields to change for the case under test
   */
  function repairRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "repair-1",
      assetId: ASSET_ID,
      faultDescription: "Crackles when the cable is moved",
      // US-008 — selected on the real query, so the fixture carries it.
      outcome: null,
      reportedAt: new Date("2026-08-01T09:00:00.000Z"),
      reporterSnapshot: null,
      reportedBy: {
        firstName: "Sam",
        lastName: "Whitfield",
        displayName: null,
      },
      asset: {
        title: "Ch 3 handheld radio mic",
        mainImage: "main.jpg",
        thumbnailImage: "thumb.jpg",
        sequentialId: "SAM-0124",
        preferredBarcodeId: null,
        qrCodes: [{ id: "qr-1" }],
        barcodes: [],
      },
      ...overrides,
    };
  }

  /**
   * Answers the bucket counts by INSPECTING the `where` each call carries,
   * rather than by call order. Order-based stubbing would keep passing if the
   * two counts were ever swapped — the exact defect it should catch.
   */
  function countByBucket({
    awaiting,
    writtenOff,
  }: {
    awaiting: number;
    writtenOff: number;
  }) {
    return ({ where }: { where: PrismaWhere }) =>
      Promise.resolve(isWrittenOffBucket(where) ? writtenOff : awaiting);
  }

  /**
   * The written-off bucket, US-008 onwards: `outcome IS NOT NULL`.
   *
   * Before US-008 this detected the deliberately-impossible `id: { in: [] }`
   * placeholder. That placeholder existed so the query path, the counts and the
   * pagination were exercised from day one — and its removal here is what
   * `DECISIONS.md` #39 promised would be a one-fragment change.
   */
  function isWrittenOffBucket(where: PrismaWhere): boolean {
    const outcome = where.outcome;
    return (
      !!outcome && typeof outcome === "object" && "not" in (outcome as object)
    );
  }

  /** The `where` the list query ran with. */
  function listWhere(): PrismaWhere {
    return (repairFindMany.mock.calls[0]?.[0]?.where ?? {}) as PrismaWhere;
  }

  beforeEach(() => {
    // why: `daysOutOfAction` is computed from the clock. Freezing it is the
    // only way to assert on the number the screen exists to show.
    vitest.useFakeTimers();
    vitest.setSystemTime(NOW);
  });

  afterEach(() => {
    vitest.useRealTimers();
  });

  it("scopes every query to the session's organisation and to open repairs", async () => {
    expect.assertions(4);
    repairFindMany.mockResolvedValue([repairRow()]);

    await getOpenRepairsForOrganization({
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    // AC5: a repair belonging to another workspace can be neither listed…
    expect(listWhere()).toMatchObject({
      organizationId: ORG_ID,
      closedAt: null,
    });
    // …nor counted, in either bucket.
    expect(repairCount).toHaveBeenCalledTimes(2);
    for (const [args] of repairCount.mock.calls) {
      expect(args.where).toMatchObject({
        organizationId: ORG_ID,
        closedAt: null,
      });
    }
  });

  it("treats `closedAt IS NULL` as the whole of 'open' — no second input", async () => {
    expect.assertions(2);

    await getOpenRepairsForOrganization({
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
      filter: "all",
    });

    // `DECISIONS.md` #31, permanent. `outcome` must not be invented here: the
    // column does not exist until US-008 and a query naming it would 500.
    expect(listWhere().closedAt).toBeNull();
    expect(listWhere()).not.toHaveProperty("outcome");
  });

  it("lists the longest-out-of-action first, with a deterministic tiebreak", async () => {
    expect.assertions(1);

    await getOpenRepairsForOrganization({
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    // The screen answers "what has been broken longest", and the `id` tiebreak
    // is what stops a row appearing on two pages when two faults share a
    // timestamp.
    expect(repairFindMany.mock.calls[0][0].orderBy).toEqual([
      { reportedAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("pages with skip/take rather than loading the workspace", async () => {
    expect.assertions(2);

    await getOpenRepairsForOrganization({
      organizationId: ORG_ID,
      page: 3,
      perPage: 20,
    });

    expect(repairFindMany.mock.calls[0][0].skip).toBe(40);
    expect(repairFindMany.mock.calls[0][0].take).toBe(20);
  });

  it("issues one query for the rows however many rows there are (AC7)", async () => {
    expect.assertions(3);
    repairFindMany.mockResolvedValue(
      Array.from({ length: 60 }, (_, index) =>
        repairRow({ id: `repair-${index}`, assetId: `asset-${index}` })
      )
    );

    const result = await getOpenRepairsForOrganization({
      organizationId: ORG_ID,
      page: 1,
      perPage: 60,
    });

    // 60 rows, one row query. The asset title, image and code all arrive on
    // the nested select — no per-row lookup, and the booking guards
    // (`getOpenRepairAssetIds` / `assertNoOpenRepairs`) never appear here.
    expect(result.items).toHaveLength(60);
    expect(repairFindMany).toHaveBeenCalledTimes(1);
    expect(assetFindMany).not.toHaveBeenCalled();
  });

  it("defaults to the awaiting bucket, which is every open repair today", async () => {
    expect.assertions(3);
    repairFindMany.mockResolvedValue([repairRow()]);
    repairCount.mockImplementation(
      countByBucket({ awaiting: 7, writtenOff: 0 })
    );

    const result = await getOpenRepairsForOrganization({
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    /**
     * AC10 — `awaiting` is the list someone checks before a Sunday, so it must
     * contain **no gear that is never coming back**. Since US-008 that means
     * `outcome IS NULL`, not merely "open".
     */
    expect(result.totalItems).toBe(7);
    expect(listWhere().outcome).toBeNull();
    expect(isWrittenOffBucket(listWhere())).toBe(false);
  });

  it("filters the written-off bucket on the real outcome column (US-008 #39)", async () => {
    expect.assertions(4);
    repairFindMany.mockResolvedValue([]);
    repairCount.mockImplementation(
      countByBucket({ awaiting: 7, writtenOff: 0 })
    );

    const result = await getOpenRepairsForOrganization({
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
      filter: "written-off",
    });

    /**
     * AC10, and why the predicate is `{ not: null }` rather than
     * `{ equals: WRITTEN_OFF }`: the enum has one member today, and matching
     * "any outcome" means a second one (lost? stolen?) shows up here
     * automatically instead of silently vanishing from every bucket.
     */
    expect(isWrittenOffBucket(listWhere())).toBe(true);
    expect(listWhere().outcome).toEqual({ not: null });
    expect(result.items).toEqual([]);
    expect(result.totalItems).toBe(0);
  });

  it("counts the `all` bucket with its own query", async () => {
    expect.assertions(2);
    repairCount
      .mockResolvedValueOnce(7) // awaiting
      .mockResolvedValueOnce(0) // written off
      .mockResolvedValueOnce(7); // all

    const result = await getOpenRepairsForOrganization({
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
      filter: "all",
    });

    // `awaiting + writtenOff` would be an assumption about a column US-008 has
    // not written yet, so `all` pays for a third count instead.
    expect(repairCount).toHaveBeenCalledTimes(3);
    expect(result.totalItems).toBe(7);
  });

  it("narrows on search without ever widening the org scope", async () => {
    expect.assertions(3);

    await getOpenRepairsForOrganization({
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
      search: "mic, crackle",
    });

    const where = listWhere();
    // Comma-separated keywords are ORed, matching item title or fault text —
    // the reminders convention.
    expect(where.OR).toHaveLength(2);
    // The search is ANDed with the scope, never spread over it (AC5).
    expect(where.organizationId).toBe(ORG_ID);
    // The bucket counts carry the same search, so a tab can't promise seven
    // rows and then show two.
    expect(repairCount.mock.calls[0][0].where.OR).toHaveLength(2);
  });

  it("reports how long each item has been out of action", async () => {
    expect.assertions(3);
    repairFindMany.mockResolvedValue([
      repairRow({
        id: "repair-old",
        reportedAt: new Date("2026-08-01T09:00:00.000Z"),
      }),
      repairRow({
        id: "repair-today",
        reportedAt: new Date("2026-08-13T08:00:00.000Z"),
      }),
      repairRow({
        id: "repair-future",
        // Clock skew must not produce "out of action for -1 days".
        reportedAt: new Date("2026-08-13T10:00:00.000Z"),
      }),
    ]);

    const { items } = await getOpenRepairsForOrganization({
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    expect(items[0].daysOutOfAction).toBe(12);
    // Under 24h reads as "Reported today" (`design.md` D3).
    expect(items[1].daysOutOfAction).toBe(0);
    expect(items[2].daysOutOfAction).toBe(0);
  });

  it("names the reporter, falling back to the snapshot then to Unknown", async () => {
    expect.assertions(3);
    repairFindMany.mockResolvedValue([
      repairRow(),
      repairRow({
        id: "repair-2",
        // The FK is `ON DELETE SET NULL`, so a deleted reporter would render
        // anonymously without the snapshot captured at write time.
        reportedBy: null,
        reporterSnapshot: {
          firstName: "Jo",
          lastName: "Baker",
          displayName: null,
        },
      }),
      repairRow({ id: "repair-3", reportedBy: null, reporterSnapshot: null }),
    ]);

    const { items } = await getOpenRepairsForOrganization({
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    expect(items[0].reporterName).toBe("Sam Whitfield");
    expect(items[1].reporterName).toBe("Jo Baker");
    expect(items[2].reporterName).toBe("Unknown");
  });

  it("carries the asset details the row renders, and marks nothing written off", async () => {
    expect.assertions(4);
    repairFindMany.mockResolvedValue([repairRow()]);

    const { items } = await getOpenRepairsForOrganization({
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    expect(items[0].assetTitle).toBe("Ch 3 handheld radio mic");
    expect(items[0].assetThumbnailImage).toBe("thumb.jpg");
    // The resolver's own input shape — the row must not re-implement
    // `resolveDisplayCode`.
    expect(items[0].assetCode).toEqual({
      sequentialId: "SAM-0124",
      preferredBarcodeId: null,
      qrCodes: [{ id: "qr-1" }],
      barcodes: [],
    });
    // A healthy open repair: not written off.
    expect(items[0].isWrittenOff).toBe(false);
  });

  it("marks a written-off row, so the `all` bucket can mix both kinds", async () => {
    expect.assertions(2);
    repairFindMany.mockResolvedValue([
      repairRow(),
      repairRow({ id: "repair-2", outcome: "WRITTEN_OFF" }),
    ]);

    const { items } = await getOpenRepairsForOrganization({
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
      filter: "all",
    });

    /**
     * `design.md` D3 — a per-ROW flag rather than a per-bucket one, which is
     * exactly what lets `all` show both kinds down one status column with no
     * second query.
     */
    expect(items[0].isWrittenOff).toBe(false);
    expect(items[1].isWrittenOff).toBe(true);
  });
});

/**
 * US-004 — one asset's fault history.
 *
 * These cover what the route-level suite cannot: that the history is scoped to
 * the asset AND the organisation (AC7), that the ordering carries the
 * documented tiebreak so paging is deterministic (AC8), that a closed row
 * reports who closed it and how long it was down (AC2), that an asset with no
 * faults produces an empty result rather than an error (AC4), and that the
 * fault text is returned exactly as it was stored (AC5).
 */
describe("getAssetRepairHistory", () => {
  /** `2026-08-13T09:00:00Z` — every age assertion below is relative to this. */
  const NOW = new Date("2026-08-13T09:00:00.000Z");

  /**
   * A history row shaped exactly as `REPAIR_HISTORY_SELECT` returns it.
   *
   * @param overrides - Fields to change for the case under test
   */
  function historyRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "repair-1",
      faultDescription: "Crackles when the cable is moved",
      reportedAt: new Date("2026-08-01T09:00:00.000Z"),
      reporterSnapshot: null,
      reportedBy: {
        firstName: "Sam",
        lastName: "Whitfield",
        displayName: null,
      },
      closedAt: null,
      closerSnapshot: null,
      closedBy: null,
      resolutionNote: null,
      ...overrides,
    };
  }

  /** The `where` the history query ran with. */
  function historyWhere(): PrismaWhere {
    return (repairFindMany.mock.calls[0]?.[0]?.where ?? {}) as PrismaWhere;
  }

  beforeEach(() => {
    // why: `daysOutOfAction` on an OPEN repair is computed from the clock.
    vitest.useFakeTimers();
    vitest.setSystemTime(NOW);
    repairFindMany.mockResolvedValue([historyRow()]);
    repairCount.mockResolvedValue(1);
  });

  afterEach(() => {
    vitest.useRealTimers();
  });

  it("scopes the query to the asset AND the organisation, never the asset alone", async () => {
    expect.assertions(2);

    await getAssetRepairHistory({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    // AC7, and the story says this in those words: repair queries filter on
    // `organizationId` as well as `assetId`.
    expect(historyWhere().assetId).toBe(ASSET_ID);
    expect(historyWhere().organizationId).toBe(ORG_ID);
  });

  it("refuses another organisation's asset without disclosing anything about it", async () => {
    expect.assertions(3);
    // The shared org guard finds no asset in this workspace.
    assetFindMany.mockResolvedValue([]);

    const thrown = (await getAssetRepairHistory({
      assetId: ASSET_ID,
      organizationId: OTHER_ORG_ID,
      page: 1,
      perPage: 20,
    }).catch((cause: unknown) => cause)) as ShelfError;

    expect(thrown.status).toBe(400);
    // No fault text, no reporter name, no asset title from the other org (AC7).
    expect(thrown.message).not.toMatch(/crackles/i);
    // Refused BEFORE any repair row was read.
    expect(repairFindMany).not.toHaveBeenCalled();
  });

  it("orders most recent first with a documented id tiebreak", async () => {
    expect.assertions(1);

    await getAssetRepairHistory({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    // AC8: two faults reported in the same second must not swap places between
    // reloads, which would make pagination skip or repeat a row.
    expect(repairFindMany.mock.calls[0]?.[0]?.orderBy).toEqual([
      { reportedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("returns the fault description exactly as it was stored", async () => {
    expect.assertions(1);
    const stored = "Intermittent — only when you wiggle it near the connector";
    repairFindMany.mockResolvedValue([
      historyRow({ faultDescription: stored }),
    ]);

    const { items } = await getAssetRepairHistory({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    // AC5: no ending deletes, blanks, overwrites or re-uses the original text.
    expect(items[0].faultDescription).toBe(stored);
  });

  it("reports an open repair's state and how long it has been down", async () => {
    expect.assertions(4);

    const { items } = await getAssetRepairHistory({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    expect(items[0].state).toBe("open");
    expect(items[0].reporterName).toBe("Sam Whitfield");
    // 1 Aug → 13 Aug, measured against the frozen clock.
    expect(items[0].daysOutOfAction).toBe(12);
    expect(items[0].closerName).toBeNull();
  });

  it("reports a closed repair's closer, outcome and time out of action", async () => {
    expect.assertions(4);
    repairFindMany.mockResolvedValue([
      historyRow({
        closedAt: new Date("2026-08-04T09:00:00.000Z"),
        closedBy: { firstName: "Neil", lastName: "Hobson", displayName: null },
        resolutionNote: "Re-terminated the male XLR",
      }),
    ]);

    const { items } = await getAssetRepairHistory({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    expect(items[0].state).toBe("repaired");
    expect(items[0].closerName).toBe("Neil Hobson");
    expect(items[0].resolutionNote).toBe("Re-terminated the male XLR");
    /**
     * AC2's "time it spent out of action" — measured `reportedAt → closedAt`,
     * NOT to now. A repair closed nine days ago after three days down must
     * still read "3 days" for ever, or every historical row grows a day older
     * every day.
     */
    expect(items[0].daysOutOfAction).toBe(3);
  });

  it("still renders a reporter who has since been deleted", async () => {
    expect.assertions(2);
    repairFindMany.mockResolvedValue([
      historyRow({
        // `reportedById` is `ON DELETE SET NULL`, so the live relation is gone.
        reportedBy: null,
        reporterSnapshot: {
          firstName: "Sam",
          lastName: "Whitfield",
          displayName: null,
        },
      }),
      historyRow({ id: "repair-2", reportedBy: null, reporterSnapshot: null }),
    ]);

    const { items } = await getAssetRepairHistory({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    // The snapshot is why history survives a user being removed.
    expect(items[0].reporterName).toBe("Sam Whitfield");
    // And when even that is missing, the row still renders (AC5) — never blank.
    expect(items[1].reporterName).toBe("Unknown");
  });

  it("pages without losing the total", async () => {
    expect.assertions(3);
    repairCount.mockResolvedValue(37);

    const { totalItems } = await getAssetRepairHistory({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      page: 3,
      perPage: 10,
    });

    expect(repairFindMany.mock.calls[0]?.[0]?.skip).toBe(20);
    expect(repairFindMany.mock.calls[0]?.[0]?.take).toBe(10);
    // AC3's count is the all-time total, not the length of this page.
    expect(totalItems).toBe(37);
  });

  it("returns an empty history rather than erroring when nothing ever broke", async () => {
    expect.assertions(2);
    repairFindMany.mockResolvedValue([]);
    repairCount.mockResolvedValue(0);

    const result = await getAssetRepairHistory({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    // AC4: an empty state, never an error and never a zero-row table.
    expect(result.items).toEqual([]);
    expect(result.totalItems).toBe(0);
  });

  it("selects every column the four-state derivation needs", async () => {
    expect.assertions(4);

    await getAssetRepairHistory({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      page: 1,
      perPage: 20,
    });

    const select = repairFindMany.mock.calls[0]?.[0]?.select ?? {};

    /**
     * `outcome` is what stops a written-off repair rendering as "open": it
     * keeps `closedAt = NULL` for ever (#37), so without this column the
     * two-way ternary labels scrapped gear "awaiting repair" (US-004 AC9, #51).
     */
    expect(select).toHaveProperty("outcome");
    expect(select).toHaveProperty("status");
    /**
     * `reinstatedAt` is US-012's, and this assertion is the INVERSE of what it
     * was before that story shipped — it used to pin the column's ABSENCE,
     * because selecting a column that did not exist would 500 every asset page.
     *
     * It is now required for the opposite reason. `resolveRepairHistoryState`
     * branches `outcome` → `reinstatedAt` → `closedAt`, so a select that omits
     * `reinstatedAt` silently collapses the fourth state into the third: a
     * scrapped-then-recovered item renders as still written off, on a page
     * where it is demonstrably bookable again.
     */
    expect(select).toHaveProperty("reinstatedAt");
    expect(select).toHaveProperty("reinstaterSnapshot");
  });
});

/**
 * US-004 — the asset-detail summary that rides on the layout loader.
 */
describe("getAssetRepairSummary", () => {
  /** A history row shaped exactly as `REPAIR_HISTORY_SELECT` returns it. */
  function historyRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "repair-1",
      faultDescription: "Crackles when the cable is moved",
      reportedAt: new Date("2026-08-01T09:00:00.000Z"),
      reporterSnapshot: null,
      reportedBy: {
        firstName: "Sam",
        lastName: "Whitfield",
        displayName: null,
      },
      closedAt: null,
      closerSnapshot: null,
      closedBy: null,
      resolutionNote: null,
      ...overrides,
    };
  }

  it("counts every fault ever recorded, not just the rows it returns", async () => {
    expect.assertions(3);
    repairFindMany.mockResolvedValue([historyRow()]);
    repairCount.mockResolvedValue(12);

    const summary = await getAssetRepairSummary({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
    });

    // AC3: three rows and a `12` is the repeat offender becoming obvious.
    expect(summary.count).toBe(12);
    expect(summary.recent).toHaveLength(1);
    expect(repairFindMany.mock.calls[0]?.[0]?.take).toBe(
      FAULT_HISTORY_CARD_LIMIT
    );
  });

  it("scopes both queries to the asset and the organisation", async () => {
    expect.assertions(2);
    repairFindMany.mockResolvedValue([]);
    repairCount.mockResolvedValue(0);

    await getAssetRepairSummary({ assetId: ASSET_ID, organizationId: ORG_ID });

    const where = (repairCount.mock.calls[0]?.[0]?.where ?? {}) as PrismaWhere;
    expect(where.assetId).toBe(ASSET_ID);
    expect(where.organizationId).toBe(ORG_ID);
  });

  it("surfaces the open repair, enriched, for the panel and the close dialog", async () => {
    expect.assertions(3);
    repairFindMany.mockResolvedValue([historyRow()]);
    repairCount.mockResolvedValue(4);

    const summary = await getAssetRepairSummary({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
    });

    /**
     * Taken from `recent[0]` with no third query: the partial unique index
     * makes a second open repair impossible, so while one is open no newer
     * repair can exist and the open one is always the most recent row.
     */
    expect(summary.openRepair?.id).toBe("repair-1");
    expect(summary.openRepair?.faultDescription).toBe(
      "Crackles when the cable is moved"
    );
    expect(summary.openRepair?.reporterName).toBe("Sam Whitfield");
  });

  it("reports no open repair when the most recent fault is closed", async () => {
    expect.assertions(2);
    repairFindMany.mockResolvedValue([
      historyRow({
        closedAt: new Date("2026-08-04T09:00:00.000Z"),
        closedBy: { firstName: "Neil", lastName: "Hobson", displayName: null },
      }),
    ]);
    repairCount.mockResolvedValue(1);

    const summary = await getAssetRepairSummary({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
    });

    // History present, nothing out of action — the card renders, the panel
    // does not.
    expect(summary.openRepair).toBeNull();
    expect(summary.count).toBe(1);
  });

  it("returns an empty summary for an asset that has never had a fault", async () => {
    expect.assertions(3);
    repairFindMany.mockResolvedValue([]);
    repairCount.mockResolvedValue(0);

    const summary = await getAssetRepairSummary({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
    });

    /**
     * AC4. This shape is also what distinguishes "no faults" from "not
     * permitted" — the layout loader ships `null` for the latter, and the two
     * must never be conflated.
     */
    expect(summary).toEqual({ count: 0, recent: [], openRepair: null });
    expect(summary.recent).toEqual([]);
    expect(summary.openRepair).toBeNull();
  });

  it("refuses another organisation's asset before reading any repair", async () => {
    expect.assertions(2);
    assetFindMany.mockResolvedValue([]);

    const thrown = (await getAssetRepairSummary({
      assetId: ASSET_ID,
      organizationId: OTHER_ORG_ID,
    }).catch((cause: unknown) => cause)) as ShelfError;

    expect(thrown.status).toBe(400);
    expect(repairFindMany).not.toHaveBeenCalled();
  });
});

/**
 * US-008 — the repair lifecycle, and the three amendments it owns inside other
 * people's stories.
 *
 * The first test in here is the one that matters most in the whole feature: it
 * pins the defect `DECISIONS.md` #38 exists to prevent. Two decisions that are
 * each correct alone — a written-off repair keeps `closedAt = NULL` (#37), and
 * US-005 closes "where `closedAt IS NULL`" — combine into "mark repaired
 * returns scrapped gear to the bookable pool".
 */
describe("US-008 lifecycle", () => {
  beforeEach(() => {
    repairFindFirst.mockResolvedValue({
      id: "repair-1",
      assetId: ASSET_ID,
      status: "REPORTED",
      closedAt: null,
      outcome: null,
      faultDescription: "Crackles when the cable is moved",
    });
  });

  describe("amendment 1 — US-005's close cannot resurrect scrapped gear (#38)", () => {
    it("names outcome:null in the compare-and-set, not just closedAt", async () => {
      expect.assertions(2);

      await closeAssetRepair({
        assetId: ASSET_ID,
        repairId: "repair-1",
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      const where = repairUpdateMany.mock.calls[0]?.[0]?.where ?? {};

      /**
       * Both conditions, or scrapped gear comes back. `closedAt: null` alone
       * MATCHES a written-off repair, because #37 keeps that column NULL for
       * ever — which is exactly what holds the asset out of the pool.
       */
      expect(where.closedAt).toBeNull();
      expect(where.outcome).toBeNull();
    });

    it("refuses to close a written-off repair, in DIFFERENT words", async () => {
      expect.assertions(3);
      // The CAS matches nothing…
      repairUpdateMany.mockResolvedValue({ count: 0 });
      // …and the failure-path read says why.
      repairFindFirst.mockResolvedValue({
        id: "repair-1",
        assetId: ASSET_ID,
        closedAt: null,
        outcome: "WRITTEN_OFF",
      });

      const thrown = (await closeAssetRepair({
        assetId: ASSET_ID,
        repairId: "repair-1",
        organizationId: ORG_ID,
        userId: USER_ID,
      }).catch((cause: unknown) => cause)) as ShelfError;

      expect(thrown.status).toBe(400);
      expect(thrown.message).toBe(REPAIR_WRITTEN_OFF_MESSAGE);
      /**
       * US-005 AC11 / US-008 AC5: recognisably different from the
       * already-closed refusal. "Someone got there first" and "this is not
       * coming back" are different facts and the reader needs to know which.
       */
      expect(thrown.message).not.toBe(REPAIR_ALREADY_CLOSED_MESSAGE);
    });
  });

  describe("stage transitions (AC2, AC8)", () => {
    it("names the legal FROM stages in the where, so the refusal is atomic", async () => {
      expect.assertions(3);

      await transitionRepairStage({
        assetId: ASSET_ID,
        repairId: "repair-1",
        organizationId: ORG_ID,
        userId: USER_ID,
        toStatus: "IN_REPAIR",
      });

      const where = repairUpdateMany.mock.calls[0]?.[0]?.where ?? {};

      // AC8 — "a conditional update whose `where` names the stage it is moving
      // FROM, and a zero row count is the 400". That also settles concurrency:
      // two leads advancing at once means exactly one wins.
      expect(where.status).toEqual({ in: ["REPORTED", "DIAGNOSED"] });
      // Terminal states stay terminal.
      expect(where.closedAt).toBeNull();
      expect(where.outcome).toBeNull();
    });

    it("allows moving BACKWARDS — a failed bench fix goes back on the bench", async () => {
      expect.assertions(1);

      await transitionRepairStage({
        assetId: ASSET_ID,
        repairId: "repair-1",
        organizationId: ORG_ID,
        userId: USER_ID,
        toStatus: "REPORTED",
      });

      // AC2a: refusing this only teaches people to work around the system.
      expect(repairUpdateMany.mock.calls[0]?.[0]?.where?.status).toEqual({
        in: ["DIAGNOSED", "IN_REPAIR"],
      });
    });

    it("refuses when the compare-and-set matches nothing, writing NOTHING", async () => {
      expect.assertions(3);
      repairUpdateMany.mockResolvedValue({ count: 0 });

      const thrown = (await transitionRepairStage({
        assetId: ASSET_ID,
        repairId: "repair-1",
        organizationId: ORG_ID,
        userId: USER_ID,
        toStatus: "DIAGNOSED",
      }).catch((cause: unknown) => cause)) as ShelfError;

      expect(thrown.status).toBe(400);
      // AC8 — "no stage change, no note, no activity event".
      expect(noteCreateMany).not.toHaveBeenCalled();
      expect(activityEventCreate).not.toHaveBeenCalled();
    });

    it("records the move as a field change, from and to", async () => {
      expect.assertions(2);

      await transitionRepairStage({
        assetId: ASSET_ID,
        repairId: "repair-1",
        organizationId: ORG_ID,
        userId: USER_ID,
        toStatus: "DIAGNOSED",
      });

      /**
       * AC6 + `.claude/rules/record-event-payload-shapes.md`: one event per
       * logical change, with the before/after in `field`/`fromValue`/`toValue`
       * rather than buried in `meta` — so "how often does a repair stall at
       * diagnosed?" stays a `groupBy`.
       */
      const written = activityEventCreate.mock.calls.map((c) => c[0]?.data);
      expect(written[0]).toMatchObject({
        action: "ASSET_REPAIR_STAGE_CHANGED",
        field: "status",
        toValue: "DIAGNOSED",
      });
      expect(written[0]?.fromValue).toBe("REPORTED");
    });

    it("records a diagnosis as its own event, and never overwrites the fault", async () => {
      expect.assertions(2);

      await transitionRepairStage({
        assetId: ASSET_ID,
        repairId: "repair-1",
        organizationId: ORG_ID,
        userId: USER_ID,
        toStatus: "DIAGNOSED",
        diagnosis: "Cold joint, male XLR pin 2",
      });

      const actions = activityEventCreate.mock.calls.map(
        (c) => c[0]?.data?.action
      );
      expect(actions).toContain("ASSET_REPAIR_DIAGNOSED");

      // AC1 — the reporter's words are the evidence for a repeat failure and
      // are never touched. Only `diagnosis` is written.
      const data = repairUpdateMany.mock.calls[0]?.[0]?.data ?? {};
      expect(data).not.toHaveProperty("faultDescription");
    });
  });

  describe("writing an item off (AC4, AC12)", () => {
    it("does NOT stamp closedAt — that is the whole mechanism", async () => {
      expect.assertions(3);

      await writeOffRepair({
        assetId: ASSET_ID,
        repairId: "repair-1",
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      const data = repairUpdateMany.mock.calls[0]?.[0]?.data ?? {};

      /**
       * AC4 / #37. Leaving `closedAt` NULL is what keeps scrapped gear out of
       * the pool through the ORDINARY booking guard — no second flag, no change
       * to the guard. It reads as a bug and is the opposite of one.
       */
      expect(data).not.toHaveProperty("closedAt");
      expect(data.outcome).toBe("WRITTEN_OFF");
      // #108 — its own actor columns, never a reuse of `closedById`, or after a
      // reinstate that person reads as having repaired it.
      expect(data.outcomeById).toBe(USER_ID);
    });

    it("warns the future bookings a second time, with different words", async () => {
      expect.assertions(2);

      await writeOffRepair({
        assetId: ASSET_ID,
        repairId: "repair-1",
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      /**
       * AC12 (#71). A second TRIGGER on US-011's fan-out, not a second fan-out
       * — so the booking lookup runs exactly as it does for a fault report.
       * The distinct copy is asserted in the notifications suite.
       */
      expect(bookingFindMany).toHaveBeenCalledTimes(1);
      const where = bookingFindMany.mock.calls[0]?.[0]?.where ?? {};
      expect(where.bookingAssets).toEqual({ some: { assetId: ASSET_ID } });
    });
  });
});

describe("reinstating a written-off asset (US-012)", () => {
  it("STAMPS closedAt — that is the only lever that returns it to the pool", async () => {
    expect.assertions(3);

    await reinstateRepair({
      assetId: ASSET_ID,
      repairId: "repair-1",
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    const data = repairUpdateMany.mock.calls[0]?.[0]?.data ?? {};

    /**
     * AC1 / #46. Bookability is `closedAt IS NULL` and may never gain a second
     * input (#31, permanent), so stamping it is not a choice — it is the only
     * thing that makes the asset bookable again. This is the mirror image of
     * the write-off test above, and the pair is the whole mechanism.
     */
    expect(data.closedAt).toBeInstanceOf(Date);
    expect(data.reinstatedAt).toBeInstanceOf(Date);
    expect(data.reinstatedById).toBe(USER_ID);
  });

  it("NEVER clears the outcome — the write-off stays on the record for ever", async () => {
    expect.assertions(2);

    await reinstateRepair({
      assetId: ASSET_ID,
      repairId: "repair-1",
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    const data = repairUpdateMany.mock.calls[0]?.[0]?.data ?? {};

    /**
     * AC3 / #47. Fault records are append-only (US-004 AC5/AC8). Clearing
     * `outcome` was one of the three rejected mechanisms precisely because the
     * row would then read as an ordinary repair and the write-off would vanish
     * — the history would say the item was fixed, which it never was.
     */
    expect(data).not.toHaveProperty("outcome");
    // And the reinstate must not be logged as a repair either.
    expect(data).not.toHaveProperty("resolutionNote");
  });

  it("leaves closedById NULL — the reinstater did not repair it (#48)", async () => {
    expect.assertions(2);

    await reinstateRepair({
      assetId: ASSET_ID,
      repairId: "repair-1",
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    const data = repairUpdateMany.mock.calls[0]?.[0]?.data ?? {};

    /**
     * The trap this story exists to avoid. `closedAt` IS set, so anything
     * sitting in `closedBy` renders as "this person repaired it" everywhere the
     * closer is shown. The reinstater gets their own columns instead.
     */
    expect(data).not.toHaveProperty("closedById");
    expect(data).not.toHaveProperty("closerSnapshot");
  });

  it("matches ONLY a live write-off, so it can never resurrect a repaired item (AC6)", async () => {
    expect.assertions(3);

    await reinstateRepair({
      assetId: ASSET_ID,
      repairId: "repair-1",
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    const where = repairUpdateMany.mock.calls[0]?.[0]?.where ?? {};

    /**
     * #49. `outcome: "WRITTEN_OFF"` is mutually exclusive with US-005's close
     * (`outcome: null`) BY CONSTRUCTION, so no path can ever do both. The
     * `closedAt: null` half is what makes a second reinstate match nothing.
     */
    expect(where.outcome).toBe("WRITTEN_OFF");
    expect(where.closedAt).toBeNull();
    // AC8 — org-scoped in the same predicate, never on id alone.
    expect(where.organizationId).toBe(ORG_ID);
  });

  it("refuses when the compare-and-set matches nothing (AC6, AC7)", async () => {
    expect.assertions(3);
    repairUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      reinstateRepair({
        assetId: ASSET_ID,
        repairId: "repair-1",
        organizationId: ORG_ID,
        userId: USER_ID,
      })
    ).rejects.toMatchObject({ status: 400 });

    /**
     * AC7's concurrency guarantee. Two leads reinstating at once BOTH run this
     * update; the first sets `closedAt`, so the second's `closedAt: null`
     * matches zero rows. A pre-read could not promise that — it would go stale
     * between the check and the write.
     */
    expect(noteCreateMany).not.toHaveBeenCalled();
    expect(activityEventCreate).not.toHaveBeenCalled();
  });

  it("says WHY it refused, distinguishing it from a write-off refusal", async () => {
    expect.assertions(1);
    repairUpdateMany.mockResolvedValue({ count: 0 });

    const error = await reinstateRepair({
      assetId: ASSET_ID,
      repairId: "repair-1",
      organizationId: ORG_ID,
      userId: USER_ID,
    }).catch((cause: ShelfError) => cause);

    // AC6 — "there is nothing to reinstate" is a different fact from "this
    // repair has already ended", and the message must not blur them.
    expect((error as ShelfError).message).toBe(
      REPAIR_REINSTATE_REFUSED_MESSAGE
    );
  });

  it("writes its OWN activity event, never a close (AC4)", async () => {
    expect.assertions(2);

    await reinstateRepair({
      assetId: ASSET_ID,
      repairId: "repair-1",
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    const actions = activityEventCreate.mock.calls.map(
      (c) => c[0]?.data?.action
    );

    /**
     * `.claude/rules/record-event-payload-shapes.md`. A reinstate stamps the
     * same column an ordinary close does, so without a distinct action the two
     * are indistinguishable and "how much written-off gear did we bring back?"
     * becomes a JSON parse instead of a groupBy.
     */
    expect(actions).toContain("ASSET_REPAIR_REINSTATED");
    expect(actions).not.toContain("ASSET_REPAIR_CLOSED");
  });

  it("refuses an asset from another organisation without disclosing it (AC8)", async () => {
    expect.assertions(2);
    assetFindFirst.mockResolvedValue(null);

    const error = await reinstateRepair({
      assetId: ASSET_ID,
      repairId: "repair-1",
      organizationId: OTHER_ORG_ID,
      userId: USER_ID,
    }).catch((cause: ShelfError) => cause);

    expect((error as ShelfError).status).toBe(404);
    // Echoes nothing about the other workspace — same non-disclosing refusal
    // as the rest of the feature.
    expect((error as ShelfError).message).toBe(REPAIR_NOT_FOUND_MESSAGE);
  });

  it("tells the future bookings it is coming back (#252)", async () => {
    expect.assertions(2);

    await reinstateRepair({
      assetId: ASSET_ID,
      repairId: "repair-1",
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    /**
     * A third TRIGGER on US-011's fan-out, not a third fan-out — so the booking
     * lookup runs exactly as it does for a report and a write-off. The distinct
     * copy is asserted in the notifications suite.
     */
    expect(bookingFindMany).toHaveBeenCalledTimes(1);
    const where = bookingFindMany.mock.calls[0]?.[0]?.where ?? {};
    expect(where.bookingAssets).toEqual({ some: { assetId: ASSET_ID } });
  });

  it("records a note naming who did it, with no injectable user text", async () => {
    expect.assertions(2);

    await reinstateRepair({
      assetId: ASSET_ID,
      repairId: "repair-1",
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    const content = noteCreateMany.mock.calls[0]?.[0]?.data?.[0]?.content ?? "";

    // AC4 — the audit trail names the actor.
    expect(content).toContain("reinstated this item");

    /**
     * There is no reinstate-reason field, so the only user-controlled value in
     * this note is the actor's own name — and that goes through the shared
     * wrapper, which escapes it into a quoted Markdoc attribute. Assert on the
     * PARSE rather than the string: a substring check misses payloads that only
     * become tags after concatenation
     * (`.claude/rules/sanitize-note-content-markdoc.md`).
     */
    const tags = [...Markdoc.parse(content).walk()].filter(
      (node) => node.type === "tag"
    );
    expect(tags.every((node) => node.tag !== "assets_list")).toBe(true);
  });
});
