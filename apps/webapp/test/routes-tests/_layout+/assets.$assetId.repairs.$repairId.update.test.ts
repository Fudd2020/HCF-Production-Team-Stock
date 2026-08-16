/**
 * Route tests for `POST /assets/:assetId/repairs/:repairId/update` (US-008).
 *
 * What these cover that the service suite cannot:
 *   - **the permission gate is `assetRepair:update`** — `OWNER`/`ADMIN` only
 *     (AC9). `BASE` can report a fault and read the history, and must still be
 *     refused here. Hiding the control is decoration; this is the enforcement
 *   - the two operations are told apart by `intent`, and a write-off cannot be
 *     reached without its explicit confirmation field
 *   - `organizationId` comes from the session, never the request
 *
 * ## Mocking policy
 *
 * The service functions are stubbed — their behaviour (the atomic CAS, the
 * events, the notes) is tested against a mocked Prisma in
 * `service.server.test.ts`, and re-testing it here would be testing a mock of
 * itself. What is under test here is the gate, the parse and the dispatch.
 *
 * @see {@link file://../../../app/routes/_layout+/assets.$assetId.repairs.$repairId.update.tsx}
 */

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  reinstateRepair,
  transitionRepairStage,
  writeOffRepair,
} from "~/modules/asset-repair/service.server";
import { action } from "~/routes/_layout+/assets.$assetId.repairs.$repairId.update";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: the service is tested directly elsewhere; here it is the boundary.
vi.mock("~/modules/asset-repair/service.server", () => ({
  transitionRepairStage: vi.fn(),
  writeOffRepair: vi.fn(),
  reinstateRepair: vi.fn(),
}));

// why: an auth boundary, and stubbing it is what lets a test drive the role.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: fire-and-forget toast emitter; irrelevant to what is under test.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

type MockFn = ReturnType<typeof vi.fn>;

const requirePermissionMock = requirePermission as unknown as MockFn;
const transitionMock = transitionRepairStage as unknown as MockFn;
const writeOffMock = writeOffRepair as unknown as MockFn;
const reinstateMock = reinstateRepair as unknown as MockFn;

const ORG_ID = "org-1";
const USER_ID = "user-1";
const ASSET_ID = "asset-1";
const REPAIR_ID = "repair-1";

const mockContext = {
  getSession: () => ({ userId: USER_ID }),
  appVersion: "1.0.0",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as unknown as Parameters<typeof action>[0]["context"];

/** POSTs a form body to the update route. */
function runAction(body: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(body)) {
    formData.append(key, value);
  }

  return action(
    createActionArgs({
      context: mockContext,
      params: { assetId: ASSET_ID, repairId: REPAIR_ID },
      request: new Request(
        `http://localhost/assets/${ASSET_ID}/repairs/${REPAIR_ID}/update`,
        { method: "POST", body: formData }
      ),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue({ organizationId: ORG_ID });
  transitionMock.mockResolvedValue({
    fromStatus: "REPORTED",
    toStatus: "DIAGNOSED",
  });
  writeOffMock.mockResolvedValue({
    repairId: REPAIR_ID,
    assetId: ASSET_ID,
    assetTitle: "Ch 3 handheld radio mic",
    faultDescription: "Crackles when the cable is moved",
  });
  reinstateMock.mockResolvedValue({
    repairId: REPAIR_ID,
    assetId: ASSET_ID,
    assetTitle: "Ch 3 handheld radio mic",
    faultDescription: "Crackles when the cable is moved",
  });
});

describe("repair update route", () => {
  it("gates on assetRepair:UPDATE — reporting is not enough", async () => {
    expect.assertions(1);

    await runAction({ intent: "transition", toStatus: "DIAGNOSED" });

    /**
     * AC9 (`DECISIONS.md` #12/#68). `BASE` holds `assetRepair: [create, read]`
     * since US-007 — they report faults and read the history — but moving a
     * repair along is a lead's judgement, and writing one off would let a
     * restricted user scrap an asset outright.
     */
    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.assetRepair,
        action: PermissionAction.update,
      })
    );
  });

  it("refuses a role without the grant, touching nothing", async () => {
    expect.assertions(3);
    requirePermissionMock.mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You don't have permission to update repairs.",
        status: 403,
        label: "Permission",
      })
    );

    const result = await runAction({
      intent: "transition",
      toStatus: "DIAGNOSED",
    });

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(403);
    expect(transitionMock).not.toHaveBeenCalled();
    expect(writeOffMock).not.toHaveBeenCalled();
  });

  it("dispatches a stage transition with the session's organisation", async () => {
    expect.assertions(2);

    await runAction({
      intent: "transition",
      toStatus: "IN_REPAIR",
      diagnosis: "Cold joint, male XLR pin 2",
    });

    expect(transitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: ASSET_ID,
        repairId: REPAIR_ID,
        // Never from the request.
        organizationId: ORG_ID,
        toStatus: "IN_REPAIR",
        diagnosis: "Cold joint, male XLR pin 2",
      })
    );
    expect(writeOffMock).not.toHaveBeenCalled();
  });

  it("treats an empty diagnosis as 'no change', not as 'blank it'", async () => {
    expect.assertions(1);

    await runAction({
      intent: "transition",
      toStatus: "DIAGNOSED",
      diagnosis: "",
    });

    /**
     * An empty textarea must not wipe a colleague's bench notes. The schema
     * transforms "" to `undefined`, and the service treats `undefined` as
     * "leave unchanged".
     */
    expect(transitionMock.mock.calls[0][0].diagnosis).toBeUndefined();
  });

  it("writes an item off only WITH the explicit confirmation", async () => {
    expect.assertions(1);

    await runAction({
      intent: "write-off",
      confirm: "WRITE_OFF",
      reason: "Connector housing cracked",
    });

    expect(writeOffMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: ASSET_ID,
        repairId: REPAIR_ID,
        organizationId: ORG_ID,
        reason: "Connector housing cracked",
      })
    );
  });

  it("REFUSES a write-off without the confirmation field", async () => {
    expect.assertions(2);

    const result = await runAction({ intent: "write-off" });

    /**
     * Writing off is terminal and permanent — the only route back is US-012 —
     * so it must not be reachable by a crafted POST that merely names the
     * intent. The confirmation is what proves a human passed through the
     * confirm step.
     */
    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(400);
    expect(writeOffMock).not.toHaveBeenCalled();
  });

  it("refuses an unknown stage rather than passing it through", async () => {
    expect.assertions(3);

    const result = await runAction({
      intent: "transition",
      toStatus: "WRITTEN_OFF",
    });

    /**
     * `fixed` and `written off` are deliberately absent from the stage enum:
     * fixed is US-005's close, and writing off has its own confirmed intent.
     * Neither may be reached by posting a stage name.
     */
    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(400);
    // And crucially: nothing was dispatched. A rejected stage name must not
    // reach the service at all.
    expect(transitionMock).not.toHaveBeenCalled();
    expect(writeOffMock).not.toHaveBeenCalled();
  });

  it("dispatches a reinstate with the session's organisation (US-012)", async () => {
    expect.assertions(3);

    await runAction({ intent: "reinstate" });

    expect(reinstateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: ASSET_ID,
        repairId: REPAIR_ID,
        // Never from the request.
        organizationId: ORG_ID,
        userId: USER_ID,
      })
    );
    // The three intents are mutually exclusive — one dispatch, never two.
    expect(transitionMock).not.toHaveBeenCalled();
    expect(writeOffMock).not.toHaveBeenCalled();
  });

  it("needs NO confirmation field to reinstate, unlike a write-off", async () => {
    expect.assertions(2);

    const result = await runAction({ intent: "reinstate" });

    /**
     * The asymmetry is deliberate (`DECISIONS.md` #103) and this test exists so
     * nobody "fixes" it into symmetry. Writing off is irreversible destruction
     * and demands a typed literal; reinstating is reversible and destroys
     * nothing — the record is append-only, and a mistake is undone by writing
     * the item off again. Spending the typed-confirmation gate here would
     * devalue it where it actually matters.
     *
     * A bare `{ intent: "reinstate" }` therefore SUCCEEDS. `payload()` is
     * returned directly on the success path (only refusals go through `data()`),
     * so the assertion is on its `error: null` discriminant rather than a
     * response status.
     */
    expect(result).toMatchObject({ error: null, success: true });
    expect(reinstateMock).toHaveBeenCalledTimes(1);
  });

  it("gates reinstate behind the SAME assetRepair:UPDATE grant (AC2)", async () => {
    expect.assertions(2);
    requirePermissionMock.mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You don't have permission to update repairs.",
        status: 403,
        label: "Permission",
      })
    );

    const result = await runAction({ intent: "reinstate" });

    /**
     * #50 — reinstate reuses US-005's grant rather than taking a new
     * `PermissionAction`, which is what makes AC2's `OWNER`/`ADMIN` restriction
     * free. A `BASE` user who can report a fault must not be able to overturn a
     * write-off by posting this intent directly.
     */
    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(403);
    expect(reinstateMock).not.toHaveBeenCalled();
  });
});
