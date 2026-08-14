/**
 * Route tests for `/assets/:assetId/report-fault` (US-001).
 *
 * The route had a loader and an action and no coverage at all
 * (`DECISIONS.md`, 2026-08-10 handoff: "the route has no test").
 *
 * What these tests cover that the service-level suite cannot:
 *   - the loader's OWN org-scoped read (`db.asset.findFirst({ id,
 *     organizationId })`) and its non-disclosing 404 (US-001 AC8)
 *   - the loader's `isQuantityTracked` / `hasOpenRepair` payload, which is what
 *     lets the form decline to render rather than posting into a refusal
 *   - the action's Zod boundary — empty, whitespace-only and over-length
 *     descriptions must be refused BEFORE anything is written (US-001 AC2)
 *   - that the whole route -> service -> note chain actually writes a repair
 *
 * ## Mocking policy
 *
 * Only the two genuine IO boundaries are stubbed: Prisma and the auth/session
 * resolution. The Zod schema, `parseData`, `reportAssetFault`, `createNotes`
 * and `assertAssetsBelongToOrg` all run for real, so a validation or
 * org-scoping regression fails these tests rather than passing through a mock.
 *
 * ⚠️ Lives under `test/routes-tests/` mirroring the route path, and imports the
 * route through the `~/routes/...` alias. A co-located route test would be
 * pulled into Vite's client module graph by dev-server warmup and would break
 * `pnpm webapp:dev` while CI stayed green
 * (`.claude/rules/no-test-files-in-app-routes.md`).
 *
 * @see {@link file://../../../app/routes/_layout+/assets.$assetId_.report-fault.tsx}
 * @see {@link file://../../../app/modules/asset-repair/service.server.ts}
 * @see {@link file://../../../app/modules/asset-repair/schema.ts}
 */

import { AssetType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";
import { assertIsDataWithResponseInit } from "@helpers/assertions";

import { db } from "~/database/db.server";
import { FAULT_DESCRIPTION_MAX_LENGTH } from "~/modules/asset-repair/schema";
import {
  action,
  loader,
} from "~/routes/_layout+/assets.$assetId_.report-fault";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: Prisma is the route's only real IO dependency. The service, the Zod
// schema and the note pipeline are the behaviour under test and are
// deliberately NOT stubbed, so org-scoping and validation run for real.
vi.mock("~/database/db.server", () => {
  const tx = {
    asset: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      // Present only so the "never touches the asset" assertion has something
      // to check. Nothing in this feature may write `availableToBook`
      // (`DECISIONS.md` #22).
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    assetRepair: { create: vi.fn() },
    note: { createMany: vi.fn() },
    // why: `recordEvent` writes the audit row via `activityEvent.create` in the
    // same transaction (`.claude/rules/use-record-event.md`).
    activityEvent: { create: vi.fn() },
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

// why: `requirePermission` resolves the session and the active workspace —
// an auth boundary, not logic under test. Stubbing it is also what lets a
// test drive `organizationId`, which is the whole point of the cross-org case.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: `sendNotification` writes to the SSE emitter and reads a request-scoped
// tab id from AsyncLocalStorage. Out-of-band UI plumbing with no bearing on
// whether the repair was recorded.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const ORG_ID = "org-1";
const OTHER_ORG_ID = "org-2";
const USER_ID = "user-1";
const ASSET_ID = "asset-1";

type MockFn = ReturnType<typeof vi.fn>;

const assetFindFirst = db.asset.findFirst as unknown as MockFn;
const assetFindMany = db.asset.findMany as unknown as MockFn;
const userFindUnique = db.user.findUnique as unknown as MockFn;
const repairCreate = db.assetRepair.create as unknown as MockFn;
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
 */
function makeReportRequest(faultDescription: string): Request {
  return new Request(`http://localhost/assets/${ASSET_ID}/report-fault`, {
    method: "POST",
    body: new URLSearchParams({ faultDescription }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

/** Runs the action for a description and returns the raw route return value. */
function runAction(faultDescription: string) {
  return action(
    createActionArgs({
      context: mockContext,
      request: makeReportRequest(faultDescription),
      params: { assetId: ASSET_ID },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  requirePermissionMock.mockResolvedValue({ organizationId: ORG_ID });

  assetFindFirst.mockResolvedValue({
    id: ASSET_ID,
    title: "Ch 3 handheld radio mic",
    type: AssetType.INDIVIDUAL,
    repairs: [],
  });
  // Satisfies `assertAssetsBelongToOrg` (the service's own call and the one
  // inside `createNotes`).
  assetFindMany.mockResolvedValue([{ id: ASSET_ID }]);
  userFindUnique.mockResolvedValue({
    firstName: "Neil",
    lastName: "Hobson",
    displayName: null,
  });
  repairCreate.mockResolvedValue({ id: "repair-1", assetId: ASSET_ID });
  noteCreateMany.mockResolvedValue({ count: 1 });
});

describe("report-fault loader", () => {
  it("returns the asset and its repair state for the form", async () => {
    expect.assertions(3);

    const result: any = await loader(
      createLoaderArgs({
        context: mockContext,
        params: { assetId: ASSET_ID },
      })
    );

    expect(result.asset).toEqual({
      id: ASSET_ID,
      title: "Ch 3 handheld radio mic",
      type: AssetType.INDIVIDUAL,
    });
    expect(result.hasOpenRepair).toBe(false);
    expect(result.isQuantityTracked).toBe(false);
  });

  it("reports an existing open repair so the form can say 'already reported'", async () => {
    expect.assertions(1);
    assetFindFirst.mockResolvedValue({
      id: ASSET_ID,
      title: "Ch 3 handheld radio mic",
      type: AssetType.INDIVIDUAL,
      repairs: [{ id: "repair-existing" }],
    });

    const result: any = await loader(
      createLoaderArgs({
        context: mockContext,
        params: { assetId: ASSET_ID },
      })
    );

    // US-001 AC5: the partial unique index would reject a second report, so
    // the form must not invite the user to type one.
    expect(result.hasOpenRepair).toBe(true);
  });

  it("flags a quantity-tracked asset so the form declines to render", async () => {
    expect.assertions(2);
    assetFindFirst.mockResolvedValue({
      id: ASSET_ID,
      title: "Gaffa tape",
      type: AssetType.QUANTITY_TRACKED,
      repairs: [],
    });

    const result: any = await loader(
      createLoaderArgs({
        context: mockContext,
        params: { assetId: ASSET_ID },
      })
    );

    // `DECISIONS.md` #23: a statement of CAPABILITY, never a policy Neil has
    // not taken. The server rejects a direct POST regardless.
    expect(result.isQuantityTracked).toBe(true);
    expect(result.quantityTrackedMessage).toBe(
      "Fault reports are recorded against individually-tracked assets."
    );
  });

  it("requires assetRepair:create rather than a generic asset permission", async () => {
    expect.assertions(1);

    await loader(
      createLoaderArgs({
        context: mockContext,
        params: { assetId: ASSET_ID },
      })
    );

    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.assetRepair,
        action: PermissionAction.create,
      })
    );
  });

  it("404s on another organisation's asset without disclosing its title", async () => {
    expect.assertions(3);
    requirePermissionMock.mockResolvedValue({ organizationId: OTHER_ORG_ID });
    // The read is org-scoped, so a foreign id can only ever resolve to null.
    assetFindFirst.mockResolvedValue(null);

    const thrown = await loader(
      createLoaderArgs({
        context: mockContext,
        params: { assetId: "asset-in-another-org" },
      })
    ).catch((cause: unknown) => cause);

    assertIsDataWithResponseInit(thrown);
    expect(thrown.init?.status).toBe(404);
    // US-001 AC8: the response must never echo the other workspace's data.
    expect(JSON.stringify(thrown.data)).not.toContain(
      "Ch 3 handheld radio mic"
    );
    // And the query it ran was scoped, so the 404 is not luck.
    expect(assetFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "asset-in-another-org", organizationId: OTHER_ORG_ID },
      })
    );
  });
});

describe("report-fault action", () => {
  it("records the fault and returns the user to the asset", async () => {
    expect.assertions(4);

    const response: any = await runAction("Crackles when the cable is moved");

    // A redirect, not a JSON payload — the form is a full-page route.
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `/assets/${ASSET_ID}/overview?faultReported=1`
    );

    const created = repairCreate.mock.calls[0]?.[0]?.data;
    // `organizationId` comes from the session, never the request body.
    expect(created.organizationId).toBe(ORG_ID);
    expect(created.faultDescription).toBe("Crackles when the cable is moved");
  });

  it("writes the system note in the same transaction as the repair", async () => {
    expect.assertions(2);

    await runAction("Crackles");

    // US-001 AC6: nothing is written if the transaction rolls back, which is
    // only true while both writes go through the same client.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(noteCreateMany).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty description without writing anything", async () => {
    expect.assertions(3);

    const response = await runAction("");

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(JSON.stringify(response.data)).toContain("Describe the fault");
    expect(repairCreate).not.toHaveBeenCalled();
  });

  it("refuses a whitespace-only description — `.trim()` runs before `.min(1)`", async () => {
    expect.assertions(3);

    const response = await runAction("   \n\t  ");

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(JSON.stringify(response.data)).toContain("Describe the fault");
    // The failure that matters: a blank fault report must not take an item out
    // of service with nothing recorded about why.
    expect(repairCreate).not.toHaveBeenCalled();
  });

  it("refuses a description over the length limit", async () => {
    expect.assertions(3);

    const response = await runAction(
      "x".repeat(FAULT_DESCRIPTION_MAX_LENGTH + 1)
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(JSON.stringify(response.data)).toContain("under 1,000 characters");
    expect(repairCreate).not.toHaveBeenCalled();
  });

  it("accepts a description exactly at the length limit", async () => {
    expect.assertions(1);

    const response: any = await runAction(
      "x".repeat(FAULT_DESCRIPTION_MAX_LENGTH)
    );

    // `.max()` is inclusive — the boundary must not be off by one, or the
    // textarea's own `maxLength` would produce an unsubmittable form.
    expect(response.status).toBe(302);
  });

  it("refuses another organisation's asset without disclosing its title", async () => {
    expect.assertions(3);
    requirePermissionMock.mockResolvedValue({ organizationId: OTHER_ORG_ID });
    // Org-scoped read inside the service: a foreign id resolves to null.
    assetFindFirst.mockResolvedValue(null);

    const response = await action(
      createActionArgs({
        context: mockContext,
        request: makeReportRequest("Broken"),
        params: { assetId: "asset-in-another-org" },
      })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(404);
    // US-001 AC8: a cross-org probe must not become a title oracle.
    expect(JSON.stringify(response.data)).not.toContain(
      "Ch 3 handheld radio mic"
    );
    expect(repairCreate).not.toHaveBeenCalled();
  });

  it("refuses a fault report against a quantity-tracked asset", async () => {
    expect.assertions(3);
    assetFindFirst.mockResolvedValue({
      id: ASSET_ID,
      title: "Gaffa tape",
      type: AssetType.QUANTITY_TRACKED,
      repairs: [],
    });

    const response = await runAction("Sticky");

    // The affordance is hidden client-side; this is the server rejecting a
    // directly-submitted POST (`DECISIONS.md` #23).
    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(JSON.stringify(response.data)).toContain(
      "Fault reports are recorded against individually-tracked assets."
    );
    expect(repairCreate).not.toHaveBeenCalled();
  });

  it("never writes to the asset itself", async () => {
    expect.assertions(2);

    await runAction("Crackles");

    // `DECISIONS.md` #22: a repair OVERRIDES `availableToBook` and must never
    // mutate it — a second stored source of truth is the drift this feature
    // exists to remove.
    expect(db.asset.update).not.toHaveBeenCalled();
    expect(db.asset.updateMany).not.toHaveBeenCalled();
  });
});
