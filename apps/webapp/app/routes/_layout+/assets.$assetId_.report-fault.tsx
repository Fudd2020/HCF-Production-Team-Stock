/**
 * Route — Report a fault (US-001).
 *
 * `GET  /assets/:assetId/report-fault` → the form's data
 * `POST /assets/:assetId/report-fault` → creates the `AssetRepair` row
 *
 * ⚠️ The filename carries a trailing underscore on `$assetId_` deliberately.
 * `assets.$assetId.report-fault.tsx` would produce the same URL but NEST inside
 * `assets.$assetId.tsx`, rendering the form underneath the asset's tab bar with
 * no tab selected. The underscore escapes that layout, exactly as
 * `assets.$assetId_.edit.tsx` does. Same URL, so `progress.md` §3.3's contract
 * is unchanged — see `design.md` §5.
 *
 * The default export (the form UI) is built to `design.md` §5 — layout, exact
 * copy, states and accessibility contract all come from there.
 *
 * All server work happens in `~/modules/asset-repair/service.server` — nothing
 * server-side may be referenced from a non-loader/action export here
 * (`.claude/rules/no-server-module-in-route-client-exports.md`).
 *
 * @see {@link file://./../../modules/asset-repair/service.server.ts}
 * @see {@link file://./../../modules/asset-repair/schema.ts}
 */

import { useEffect, useId, useState } from "react";
import { AssetType } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useLocation,
} from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { RepairNoticePanel } from "~/components/asset-repair/repair-notice-panel";
import { AssetImage } from "~/components/assets/asset-image/component";
import Input from "~/components/forms/input";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";

import { db } from "~/database/db.server";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import {
  FAULT_DESCRIPTION_MAX_LENGTH,
  reportFaultSchema,
} from "~/modules/asset-repair/schema";
import {
  QUANTITY_TRACKED_REPAIR_MESSAGE,
  reportAssetFault,
} from "~/modules/asset-repair/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { resolveCancelTo } from "~/utils/cancel-destination";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import {
  assertIsPost,
  error,
  getParams,
  getRefererPath,
  parseData,
  payload,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export const meta = () => [{ title: appendToMetaTitle("Report a fault") }];

/**
 * Loads the asset the fault is being reported against.
 *
 * Returns `type` so the form can decline to render for a `QUANTITY_TRACKED`
 * asset, and `hasOpenRepair` so it can say "already reported" rather than
 * letting the user type a description into a submission the partial unique
 * index will reject (US-001 AC5).
 *
 * @throws 403 when the caller's role lacks `assetRepair:create` (AC10)
 * @throws 404 when the asset is not in the caller's organization — deliberately
 *   non-disclosing, it never echoes another workspace's asset title (AC8)
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.assetRepair,
      action: PermissionAction.create,
    });

    const asset = await db.asset.findFirst({
      // Org-scoped read: a foreign id can only ever resolve to `null` here.
      where: { id: assetId, organizationId },
      select: {
        id: true,
        title: true,
        type: true,
        // Presentation only — the header renders the asset's image so the
        // reporter can confirm they are reporting against the item in their
        // hand (`design.md` §5). `AssetImage` re-signs an expired URL itself.
        mainImage: true,
        thumbnailImage: true,
        mainImageExpiration: true,
        // One join, not a second query. `take: 1` is enough — the partial
        // unique index guarantees at most one open repair per asset.
        repairs: {
          where: { closedAt: null },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!asset) {
      throw new ShelfError({
        cause: null,
        label: "Asset Repair",
        status: 404,
        shouldBeCaptured: false,
        title: "Asset not found",
        message:
          "Asset not found. Are you sure it exists in your current workspace?",
        additionalData: { assetId, organizationId },
      });
    }

    const header: HeaderData = {
      title: "Report a fault",
      subHeading: asset.title,
    };

    return payload({
      asset: {
        id: asset.id,
        title: asset.title,
        type: asset.type,
        mainImage: asset.mainImage,
        thumbnailImage: asset.thumbnailImage,
        mainImageExpiration: asset.mainImageExpiration,
      },
      header,
      /**
       * Best-effort "go back", snapshotted by the form on mount and run
       * through `resolveCancelTo`. It is `null` on direct navigation,
       * bookmarks and restrictive `Referrer-Policy`, which is exactly why it
       * may never be bound straight to `<Button to>`
       * (`.claude/rules/resolve-nullish-button-to.md`).
       */
      referer: getRefererPath(request),
      hasOpenRepair: asset.repairs.length > 0,
      /**
       * `DECISIONS.md` #23 — the affordance is not rendered for
       * quantity-tracked assets. The server rejects a direct POST regardless;
       * this is so the form can say the same thing without duplicating the
       * `AssetType` check anywhere else in the feature.
       */
      isQuantityTracked: asset.type === AssetType.QUANTITY_TRACKED,
      quantityTrackedMessage: QUANTITY_TRACKED_REPAIR_MESSAGE,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw data(error(reason), { status: reason.status });
  }
}

/**
 * Creates the fault report and returns the user to the asset.
 *
 * Validation errors come back in the shape `getValidationErrors` expects, so
 * the form renders them field-level even when client-side validation was
 * bypassed (`CLAUDE.md` § Form Validation Pattern, US-001 AC2).
 *
 * Error cases:
 * - 400 validation — empty / whitespace-only / over-length description
 * - 400 quantity-tracked asset (`DECISIONS.md` #23)
 * - 400 an open fault report already exists (AC5, via `P2002`)
 * - 403 role lacks `assetRepair:create` (AC10)
 * - 404 asset not in the caller's organization, non-disclosing (AC8)
 */
export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.assetRepair,
      action: PermissionAction.create,
    });

    const { faultDescription } = parseData(
      await request.formData(),
      reportFaultSchema
    );

    await reportAssetFault({
      assetId,
      // From the session, never the request.
      organizationId,
      userId,
      faultDescription,
    });

    sendNotification({
      title: "Fault reported",
      message:
        "This item is now out of action and cannot be booked until the repair is marked complete.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return redirect(`/assets/${assetId}/overview?faultReported=1`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return data(error(reason), { status: reason.status });
  }
}

/**
 * Report-fault form (US-001, `design.md` §5).
 *
 * Three mutually exclusive renders:
 *
 * 1. **Quantity-tracked asset** — the affordance is not offered anywhere
 *    (`DECISIONS.md` #23), so reaching this URL means a direct navigation. The
 *    panel states what the system CAN do and nothing about policy.
 * 2. **An open fault already exists** — the form is replaced rather than shown
 *    and rejected, so nobody types 400 characters into a doomed submission
 *    (US-001 AC5).
 * 3. **The form.**
 *
 * @returns The report-fault page
 */
export default function ReportFaultPage() {
  const {
    asset,
    referer,
    hasOpenRepair,
    isQuantityTracked,
    quantityTrackedMessage,
  } = useLoaderData<typeof loader>();

  const zo = useZorm("ReportFault", reportFaultSchema);
  const disabled = useDisabled();
  const descriptionRef = useAutoFocus<HTMLTextAreaElement>();

  /** Live character count for the counter. Independent of everything else. */
  const [descriptionLength, setDescriptionLength] = useState(0);

  /**
   * Snapshot the referer ONCE on mount. This is deliberately NOT reactive:
   * any navigation that stays on this route re-runs the loader with
   * `Referer: /assets/:id/report-fault`, so re-reading it later makes Cancel
   * point at itself — a link that goes nowhere, invisible to typecheck and to
   * unit tests. See `.claude/rules/resolve-nullish-button-to.md`.
   */
  const [initialReferer] = useState(referer);
  const { pathname } = useLocation();
  const cancelTo = resolveCancelTo({
    referer: initialReferer,
    currentPathname: pathname,
    fallback: `/assets/${asset.id}/overview`,
  });

  /**
   * Server-side validation fallback. Client-side validation can be bypassed
   * (JS disabled, a crafted POST) and can diverge from the server, so every
   * field ORs the server message over the client one
   * (`CLAUDE.md` § Form Validation Pattern, US-001 AC2).
   */
  const actionData = useActionData<DataOrErrorResponse>();
  const validationErrors = getValidationErrors<typeof reportFaultSchema>(
    actionData?.error
  );
  const descriptionError =
    validationErrors?.faultDescription?.message ||
    zo.errors.faultDescription()?.message;

  /**
   * Everything the action can refuse with that is NOT a field-level problem —
   * the 400 for a quantity-tracked asset and the 400 for a lost race on the
   * partial unique index (US-001 AC5). Rendered from the server's own message
   * so the words the user reads are the words the contract fixes.
   */
  const submitError =
    actionData?.error && !validationErrors ? actionData.error : null;

  const helpId = useId();
  const errorId = useId();
  const counterId = useId();

  const atLimit = descriptionLength >= FAULT_DESCRIPTION_MAX_LENGTH;

  /**
   * `aria-describedby` takes a space-separated ID list. Built by hand rather
   * than through `tw()` — that helper is a Tailwind class merger and would be
   * free to rewrite these tokens.
   */
  const describedBy = [helpId, counterId, descriptionError ? errorId : null]
    .filter(Boolean)
    .join(" ");

  /**
   * Move focus to the field when the SERVER rejects the description.
   *
   * why: `useAutoFocus` covers mount, which is the client-validation case
   * (the page never remounts, so it cannot help here). A server-side rejection
   * arrives as new `actionData` on the same mounted form — without this, a
   * keyboard or screen-reader user is left at the submit button with an error
   * announced somewhere above them. `design.md` §13 item 5 requires focus to
   * move to the first invalid field.
   */
  useEffect(() => {
    if (validationErrors?.faultDescription) {
      descriptionRef.current?.focus();
    }
    // `actionData` identity changes on every action response, which is exactly
    // the "a submission just came back" signal we want to react to.
  }, [actionData, validationErrors, descriptionRef]);

  const headerSlots = {
    "left-of-title": (
      <AssetImage
        key={asset.id}
        asset={{
          id: asset.id,
          mainImage: asset.mainImage,
          thumbnailImage: asset.thumbnailImage,
          mainImageExpiration: asset.mainImageExpiration,
        }}
        alt={`Image of ${asset.title}`}
        className="mr-4 size-14 rounded border object-cover"
      />
    ),
  };

  /**
   * Quantity-tracked: no form at all. The message is the contract's literal
   * and states a capability, never a policy or a future intention (US-001 AC9).
   */
  if (isQuantityTracked) {
    return (
      <div className="relative">
        <Header slots={headerSlots} />
        <Card className="max-w-2xl">
          {/* why: `shelf-ux-designer` ruling (DECISIONS.md canonical #117).
              "Aren't available here" reads as *not yet* — a future intention —
              which is exactly what DECISIONS.md #17/#23 forbid this refusal
              implying: Neil DEFERRED the quantity-tracked product rule rather
              than taking it, so the copy must state a capability, never a
              roadmap. This title also matches the server's own 400 title, so
              one refusal reads identically whichever path caught it. */}
          <RepairNoticePanel tone="neutral" title="Can't report a fault here">
            <p>{quantityTrackedMessage}</p>
          </RepairNoticePanel>
          <div className="mt-4 flex justify-end">
            <Button to={cancelTo} variant="secondary">
              Back
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  /** Already out of action — replace the form rather than let it be typed into. */
  if (hasOpenRepair) {
    return (
      <div className="relative">
        <Header slots={headerSlots} />
        <Card className="max-w-2xl">
          <RepairNoticePanel
            tone="danger"
            title="This item already has an open fault report"
          >
            <p>
              It's already out of action and can't be booked or checked out. A
              lead needs to mark it repaired before another fault can be
              reported.
            </p>
          </RepairNoticePanel>
          <div className="mt-4 flex justify-end">
            <Button to={`/assets/${asset.id}/overview`} variant="secondary">
              See what was reported
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative">
      <Header slots={headerSlots} />

      <Card className="max-w-2xl">
        <RepairNoticePanel
          tone="danger"
          title="This takes the item out of action"
          className="mb-5"
        >
          <p>
            It can't be booked or checked out until a lead marks it repaired.
            Reporting a fault doesn't cancel any booking it's already on.
          </p>
        </RepairNoticePanel>

        {submitError ? (
          <RepairNoticePanel
            tone="danger"
            title={submitError.title || "We couldn't report that fault"}
            className="mb-5"
          >
            <p>{submitError.message}</p>
          </RepairNoticePanel>
        ) : null}

        <Form ref={zo.ref} method="post">
          <Input
            ref={descriptionRef}
            label="What's wrong?"
            inputType="textarea"
            name={zo.fields.faultDescription()}
            rows={6}
            /**
             * `Input`'s textarea defaults to `maxLength={250}`, which would
             * silently truncate against a 1,000-character schema with no
             * message at all. Always pass it explicitly here.
             */
            maxLength={FAULT_DESCRIPTION_MAX_LENGTH}
            required
            placeholder="e.g. Crackles when the cable is moved near the connector"
            error={descriptionError}
            /** Rendered below with `role="alert"` and wired via aria-describedby. */
            hideErrorText
            aria-invalid={descriptionError ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) =>
              setDescriptionLength(event.target.value.length)
            }
            disabled={disabled}
          />

          {descriptionError ? (
            <p
              id={errorId}
              role="alert"
              className="mt-1 text-sm text-error-600"
            >
              {descriptionError}
            </p>
          ) : null}

          <div className="mt-2 flex items-start justify-between gap-4">
            <p id={helpId} className="text-sm text-gray-500">
              Say what you noticed and when. The team leads are emailed straight
              away, and this stays on the item's fault history.
            </p>
            <span
              id={counterId}
              className={tw(
                "shrink-0 text-sm tabular-nums",
                atLimit ? "text-error-600" : "text-gray-500"
              )}
            >
              {descriptionLength}/{FAULT_DESCRIPTION_MAX_LENGTH}
            </span>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button
              to={cancelTo}
              variant="secondary"
              width="full"
              className="md:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={disabled}
              width="full"
              className="md:w-auto"
            >
              {disabled ? "Reporting…" : "Report fault"}
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  );
}
