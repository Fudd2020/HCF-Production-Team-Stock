/**
 * Route — Mark a repair as repaired (US-005).
 *
 * `POST /assets/:assetId/repairs/:repairId/close` → stamps `closedAt` on the
 * repair, which is the whole return-to-service (`DECISIONS.md` #31: bookability
 * is `closedAt IS NULL` and only that, so no second write exists anywhere).
 *
 * **This route has no screen.** `design.md` §8 makes "Mark as repaired" a
 * dialog launched by `useFetcher` from two surfaces — the out-of-action panel
 * on the asset (§6.3) and the row action on `/repairs` (§9) — so the action
 * returns DATA rather than redirecting: a redirect would yank a lead out of a
 * `/repairs` sweep after every row. `/repairs` itself deliberately gains no
 * action of its own; both launchers post here. The default export (if any UI
 * ever needs one) belongs to `shelf-frontend-dev`.
 *
 * A GET here is a mis-navigation (a pasted URL, a bookmark), so the loader
 * simply sends the user to the asset rather than rendering an empty page inside
 * the asset's tab bar.
 *
 * All server work happens in `~/modules/asset-repair/service.server` — nothing
 * server-side may be referenced from a non-loader/action export here
 * (`.claude/rules/no-server-module-in-route-client-exports.md`).
 *
 * @see {@link file://./../../modules/asset-repair/service.server.ts}
 * @see {@link file://./../../modules/asset-repair/schema.ts}
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { z } from "zod";

import { closeRepairSchema } from "~/modules/asset-repair/schema";
import { closeAssetRepair } from "~/modules/asset-repair/service.server";
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

/** Both ids arrive from the URL and are treated as untrusted input throughout. */
const paramsSchema = z.object({
  assetId: z.string(),
  repairId: z.string(),
});

/**
 * Nobody navigates here on purpose — the close is a dialog, not a page.
 *
 * @returns A redirect to the asset's overview
 */
export function loader({ params }: LoaderFunctionArgs) {
  const { assetId } = getParams(params, paramsSchema);
  return redirect(`/assets/${assetId}/overview`);
}

/**
 * Closes the repair and puts the asset back in the bookable pool.
 *
 * Permission is `assetRepair:update`, which the matrix grants to `OWNER` and
 * `ADMIN` only (`DECISIONS.md` #12, US-005 AC9) — no new `PermissionAction` is
 * introduced (#50). Client-side gating of the launcher is cosmetic; this is the
 * enforcement.
 *
 * Validation errors come back in the shape `getValidationErrors` expects, so
 * the dialog renders them field-level even when client-side validation was
 * bypassed (`CLAUDE.md` § Form Validation Pattern).
 *
 * Error cases:
 * - 400 validation — resolution note over the length limit
 * - 400 the repair is already closed (AC6)
 * - 403 role lacks `assetRepair:update` (AC9)
 * - 404 asset or repair not in the caller's organization, or the two do not
 *   belong together — non-disclosing (AC7)
 *
 * @returns `{ success: true, repairId, assetId, assetTitle }` on success
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

    const { resolutionNote } = parseData(
      await request.formData(),
      closeRepairSchema
    );

    const closed = await closeAssetRepair({
      assetId,
      repairId,
      // From the session, never the request.
      organizationId,
      userId,
      resolutionNote,
    });

    sendNotification({
      title: "Back in service",
      message: `${closed.assetTitle} can be booked again.`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    /**
     * Data, not a redirect — see the file doc. The dialog closes itself on
     * `success` and the surrounding page revalidates, which is what removes the
     * item from `/repairs` (AC4) and clears the out-of-action panel (AC3).
     */
    return payload({
      success: true,
      repairId: closed.repairId,
      assetId: closed.assetId,
      assetTitle: closed.assetTitle,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId, repairId });
    return data(error(reason), { status: reason.status });
  }
}
