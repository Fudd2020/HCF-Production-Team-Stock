/**
 * Route tests for `POST /assets/:assetId/repairs/:repairId/close` (US-005).
 *
 * What these cover that the service-level suite cannot:
 *   - the permission gate is `assetRepair:update`, which the matrix grants to
 *     `OWNER`/`ADMIN` only (`DECISIONS.md` #12, US-005 AC9). A `BASE` or
 *     `SELF_SERVICE` caller never gets past `requirePermission`
 *   - `organizationId` comes from the session and is what reaches the
 *     compare-and-set's `where` (AC7)
 *   - the Zod boundary on the optional resolution note, and that an empty
 *     textarea becomes "no note" rather than an empty one
 *   - the action returns DATA rather than redirecting, because the close is a
 *     `useFetcher` dialog launched from two surfaces (`design.md` §8)
 *
 * ## Mocking policy
 *
 * Only the genuine IO boundaries are stubbed: Prisma, the auth/session
 * resolution and the SSE notification emitter. The Zod schema, `parseData`,
 * `closeAssetRepair`, `createNotes` and `assertAssetsBelongToOrg` all run for
 * real, so a validation or org-scoping regression fails these tests rather
 * than passing through a mock.
 *
 * ⚠️ Lives under `test/routes-tests/` mirroring the route path, and imports the
 * route through the `~/routes/...` alias
 * (`.claude/rules/no-test-files-in-app-routes.md`).
 *
 * @see {@link file://../../../app/routes/_layout+/assets.$assetId.repairs.$repairId.close.tsx}
 * @see {@link file://../../../app/modules/asset-repair/service.server.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { RESOLUTION_NOTE_MAX_LENGTH } from "~/modules/asset-repair/schema";
import {
  action,
  loader,
} from "~/routes/_layout+/assets.$assetId.repairs.$repairId.close";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: Prisma is the route's only real IO dependency. The service, the Zod
// schema and the note pipeline are the behaviour under test and are
// deliberately NOT stubbed.
vi.mock("~/database/db.server", () => {
  const tx = {
    asset: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      // Present only so the "never touches the asset" assertion has something
      // to check. Closing a repair returns the item to service through
      // `closedAt` alone (`DECISIONS.md` #22/#31).
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    assetRepair: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
    note: { createMany: vi.fn() },
  };

  return {
    db: {
      ...tx,
      // why: the service uses the callback form of `$transaction`; route it
      // through the same object so per-test overrides are visible inside it.
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx)
      ),
    },
  };
});

// why: `requirePermission` resolves the session and the active workspace — an
// auth boundary, not logic under test. Stubbing it is also what lets a test
// drive `organizationId`, which is the whole point of the cross-org case.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: `sendNotification` writes to the SSE emitter and reads a request-scoped
// tab id from AsyncLocalStorage. Out-of-band UI plumbing.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const ORG_ID = "org-1";
const USER_ID = "user-1";
const ASSET_ID = "asset-1";
const REPAIR_ID = "repair-1";

type MockFn = ReturnType<typeof vi.fn>;

const assetFindFirst = db.asset.findFirst as unknown as MockFn;
const assetFindMany = db.asset.findMany as unknown as MockFn;
const userFindUnique = db.user.findUnique as unknown as MockFn;
const repairUpdateMany = db.assetRepair.updateMany as unknown as MockFn;
const repairFindFirst = db.assetRepair.findFirst as unknown as MockFn;
const noteCreateMany = db.note.createMany as unknown as MockFn;
const requirePermissionMock = requirePermission as unknown as MockFn;

const mockContext = {
  getSession: () => ({ userId: USER_ID }),
  appVersion: "1.0.0",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as any;

/**
 * Builds a real POST `Request` with real URL-encoded form data, so the route's
 * `await request.formData()` and the real `parseData` both run unmocked.
 *
 * @param resolutionNote - The optional note, as the textarea would submit it
 */
function makeCloseRequest(resolutionNote?: string): Request {
  const body = new URLSearchParams();
  if (resolutionNote !== undefined) {
    body.set("resolutionNote", resolutionNote);
  }

  return new Request(
    `http://localhost/assets/${ASSET_ID}/repairs/${REPAIR_ID}/close`,
    {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );
}

/** Runs the action for an optional note and returns the raw route return value. */
function runAction(resolutionNote?: string) {
  return action(
    createActionArgs({
      context: mockContext,
      request: makeCloseRequest(resolutionNote),
      params: { assetId: ASSET_ID, repairId: REPAIR_ID },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  requirePermissionMock.mockResolvedValue({ organizationId: ORG_ID });

  assetFindFirst.mockResolvedValue({
    id: ASSET_ID,
    title: "Ch 3 handheld radio mic",
  });
  // Satisfies `assertAssetsBelongToOrg` (the service's own call and the one
  // inside `createNotes`).
  assetFindMany.mockResolvedValue([{ id: ASSET_ID }]);
  userFindUnique.mockResolvedValue({
    firstName: "Neil",
    lastName: "Hobson",
    displayName: null,
  });
  repairUpdateMany.mockResolvedValue({ count: 1 });
  noteCreateMany.mockResolvedValue({ count: 1 });
});

describe("close-repair action", () => {
  it("closes the repair and answers with data, not a redirect", async () => {
    expect.assertions(3);

    const response: any = await runAction(
      "Re-terminated the male XLR and tested it"
    );

    // `design.md` §8: the dialog is a `useFetcher` launched from the asset page
    // AND from `/repairs`. A redirect would yank a lead out of a sweep.
    expect(response.success).toBe(true);
    expect(response.assetTitle).toBe("Ch 3 handheld radio mic");
    expect(repairUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("requires assetRepair:update — the OWNER/ADMIN grant", async () => {
    expect.assertions(1);

    await runAction();

    // US-005 AC9 / `DECISIONS.md` #12 + #50: reuse the existing `update`
    // action; `BASE` and `SELF_SERVICE` hold `assetRepair: []`, so this call
    // is what refuses them. Client-side gating of the launcher is cosmetic.
    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.assetRepair,
        action: PermissionAction.update,
      })
    );
  });

  it("scopes the write with the session's organisation, not the request's", async () => {
    expect.assertions(1);

    await runAction();

    expect(repairUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: REPAIR_ID,
          assetId: ASSET_ID,
          organizationId: ORG_ID,
          closedAt: null,
        }),
      })
    );
  });

  it("treats an empty textarea as no note", async () => {
    expect.assertions(2);

    const response: any = await runAction("");

    // The field is optional (`design.md` §8) — an empty submission is a valid
    // close, and must not persist an empty "what was done" note.
    expect(response.success).toBe(true);
    expect(
      repairUpdateMany.mock.calls[0]?.[0]?.data?.resolutionNote
    ).toBeNull();
  });

  it("refuses a note over the length limit without writing anything", async () => {
    expect.assertions(3);

    const response = await runAction(
      "x".repeat(RESOLUTION_NOTE_MAX_LENGTH + 1)
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(JSON.stringify(response.data)).toContain("under 1,000 characters");
    expect(repairUpdateMany).not.toHaveBeenCalled();
  });

  it("accepts a note exactly at the length limit", async () => {
    expect.assertions(1);

    const response: any = await runAction(
      "x".repeat(RESOLUTION_NOTE_MAX_LENGTH)
    );

    // `.max()` is inclusive — off by one here makes the textarea's own
    // `maxLength` produce an unsubmittable dialog.
    expect(response.success).toBe(true);
  });

  it("surfaces the already-closed refusal as a 400", async () => {
    expect.assertions(3);
    // The compare-and-set matched nothing …
    repairUpdateMany.mockResolvedValue({ count: 0 });
    // … because the repair was closed a moment earlier.
    repairFindFirst.mockResolvedValue({
      id: REPAIR_ID,
      assetId: ASSET_ID,
      closedAt: new Date("2026-08-10T09:00:00.000Z"),
    });

    const response = await runAction();

    // US-005 AC6: a stale tab / double-click / replay is refused, and the
    // dialog gets a message it can render inline.
    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(JSON.stringify(response.data)).toContain("already closed");
    expect(noteCreateMany).not.toHaveBeenCalled();
  });

  it("404s on another organisation's repair without disclosing it", async () => {
    expect.assertions(3);
    repairUpdateMany.mockResolvedValue({ count: 0 });
    // Org-scoped read on the failure path: a foreign id resolves to null.
    repairFindFirst.mockResolvedValue(null);

    const response = await action(
      createActionArgs({
        context: mockContext,
        request: makeCloseRequest(),
        params: { assetId: ASSET_ID, repairId: "repair-in-another-org" },
      })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(404);
    // AC7: a cross-org probe must not become an existence oracle.
    expect(JSON.stringify(response.data)).toContain(
      "We couldn't find that fault report."
    );
    expect(noteCreateMany).not.toHaveBeenCalled();
  });

  it("never writes to the asset itself", async () => {
    expect.assertions(2);

    await runAction("Re-terminated the male XLR");

    // AC2/AC3: bookability is derived from `closedAt IS NULL` alone, so
    // nothing here may restore `availableToBook` (#22) or write `status` (#21).
    expect(db.asset.update).not.toHaveBeenCalled();
    expect(db.asset.updateMany).not.toHaveBeenCalled();
  });
});

describe("close-repair loader", () => {
  it("redirects a mis-navigation to the asset", async () => {
    expect.assertions(2);

    const response: any = await loader(
      createLoaderArgs({
        context: mockContext,
        params: { assetId: ASSET_ID, repairId: REPAIR_ID },
      })
    );

    // The close is a dialog, not a page — a pasted URL must not land on an
    // empty route inside the asset's tab bar.
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `/assets/${ASSET_ID}/overview`
    );
  });
});
