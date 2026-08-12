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
 */

import Markdoc from "@markdoc/markdoc";
import { AssetType, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vitest } from "vitest";

import { db } from "~/database/db.server";
import type { ShelfError } from "~/utils/error";

import {
  closeAssetRepair,
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
    },
    note: { createMany: vitest.fn() },
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
const noteCreateMany = db.note.createMany as unknown as MockFn;

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
