/**
 * Route — move a repair between stages, or write the item off (US-008).
 *
 * `POST /assets/:assetId/repairs/:repairId/update`, with the operation
 * discriminated on an `intent` field:
 *
 * | intent        | Effect                                                   |
 * | ------------- | -------------------------------------------------------- |
 * | `transition`  | move between OPEN stages, optionally recording a diagnosis |
 * | `write-off`   | terminal — the item is beyond repair                     |
 * | `reinstate`   | undoes a write-off, returning the item to the pool (US-012) |
 *
 * **One route rather than two** because both are the same shape from the
 * client's side: a small form in a dialog, posting to an open repair, returning
 * data rather than redirecting. `assets.$assetId.tsx`'s action uses the same
 * `intent` pattern.
 *
 * ⚠️ **A sibling of the Repairs tab, not a child.** Named `…$repairId.update`
 * alongside `…$repairId.close`, so neither nests under
 * `assets.$assetId.repairs._index` and a POST here never runs the tab's loader.
 *
 * Returns DATA, not a redirect (`DECISIONS.md` #182): the dialog is launched
 * from the Repairs tab and from `/repairs`, and a redirect would yank a lead out
 * of a sweep after every row. The fetcher's automatic revalidation is what
 * refreshes the surrounding page.
 *
 * @see {@link file://./../../modules/asset-repair/service.server.ts}
 * @see {@link file://./assets.$assetId.repairs.$repairId.close.tsx} the sibling
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { z } from "zod";

import { updateRepairSchema } from "~/modules/asset-repair/schema";
import {
  reinstateRepair,
  transitionRepairStage,
  writeOffRepair,
} from "~/modules/asset-repair/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  assertIsPost,
  error,
  getParams,
  parseData,
  payload,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const paramsSchema = z.object({
  assetId: z.string(),
  repairId: z.string(),
});

/**
 * Nobody navigates here on purpose — these are dialogs, not pages.
 *
 * @returns A redirect to the asset's overview
 */
export function loader({ params }: LoaderFunctionArgs) {
  const { assetId } = getParams(params, paramsSchema);
  return redirect(`/assets/${assetId}/overview`);
}

/**
 * Applies a stage transition or a write-off.
 *
 * **Permission is `assetRepair:update` — `OWNER`/`ADMIN` only** (US-008 AC9,
 * `DECISIONS.md` #12/#68). `BASE` and `SELF_SERVICE` may report a fault
 * (US-007) and `BASE` may read the history (#35), but neither moves a repair
 * along and neither writes an item off. Hiding the controls is cosmetic; this
 * is the enforcement.
 *
 * Every refusal below comes from the service's atomic compare-and-set rather
 * than a pre-read, so an illegal transition, a terminal repair and a lost race
 * are one code path and none of them writes anything (AC8).
 *
 * Error cases:
 * - 400 validation — diagnosis too long, or the write-off confirmation missing
 * - 400 the move is illegal, or the repair has already ended
 * - 403 role lacks `assetRepair:update` (AC9)
 * - 404 the asset or repair does not resolve in this organisation (AC11)
 *
 * @returns `{ success: true, … }` on success
 */
export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId, repairId } = getParams(params, paramsSchema, {
    additionalData: { userId },
  });

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.assetRepair,
      action: PermissionAction.update,
    });

    const parsed = parseData(await request.formData(), updateRepairSchema);

    if (parsed.intent === "write-off") {
      const written = await writeOffRepair({
        assetId,
        repairId,
        // From the session, never the request.
        organizationId,
        userId,
        reason: parsed.reason,
      });

      sendNotification({
        title: "Written off",
        message: `${written.assetTitle} is recorded as beyond repair.`,
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      return payload({ success: true, repairId, assetId });
    }

    if (parsed.intent === "reinstate") {
      const reinstated = await reinstateRepair({
        assetId,
        repairId,
        // From the session, never the request.
        organizationId,
        userId,
      });

      sendNotification({
        title: "Back in service",
        message: `${reinstated.assetTitle} is bookable again.`,
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      return payload({ success: true, repairId, assetId });
    }

    const moved = await transitionRepairStage({
      assetId,
      repairId,
      organizationId,
      userId,
      toStatus: parsed.toStatus,
      diagnosis: parsed.diagnosis,
    });

    sendNotification({
      title: "Repair updated",
      message: "The repair has moved on.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return payload({
      success: true,
      repairId,
      assetId,
      fromStatus: moved.fromStatus,
      toStatus: moved.toStatus,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId, repairId });
    return data(error(reason), { status: reason.status });
  }
}
