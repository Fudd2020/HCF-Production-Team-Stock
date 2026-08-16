/**
 * Resolves a selection of assets or kits into printable label data (US-001).
 *
 * `GET /api/labels/get-items-for-print?entity=asset&ids=…`
 *
 * ## Why this is not the existing bulk-QR endpoint
 *
 * `assets.get-assets-for-bulk-qr-download` resolves **assets only**, and US-001
 * AC8 needs kits too (`.claude/rules/code-bearing-entity-list-consistency.md` —
 * both axes). Rather than bolt a second entity onto an endpoint whose contract
 * is a ZIP download, this serves both and reuses the machinery that actually
 * matters: `getAssetsWhereInput` / `getKitsWhereInput` for the select-all path
 * (AC7), so a filtered "select all" resolves exactly the rows the user can see.
 *
 * Two behaviours differ from the download endpoint on purpose:
 *
 * 1. **QR rows are fetched in ONE query, not one per item.** The download loops
 *    `generateQrObj` serially — fine for its 100-item ceiling, painful at this
 *    one's. See {@link MAX_LABELS_PER_PRINT}.
 * 2. **Items without a QR are skipped, never created.** This is a GET; it must
 *    not write. Assets always have a QR, kits may not — so the count comes back
 *    as `skippedCount` and the dialog says so rather than printing a blank
 *    sticker onto real stationery.
 *
 * @see {@link file://./../../components/labels/print-labels-dialog.tsx}
 * @see {@link file://./assets.get-assets-for-bulk-qr-download.ts} the sibling
 */

import type { Prisma } from "@prisma/client";
import type { ErrorCorrectionLevel, TypeNumber } from "qrcode-generator";
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { db } from "~/database/db.server";
import { getAssetsWhereInput } from "~/modules/asset/utils.server";
import { getKitsWhereInput } from "~/modules/kit/utils.server";
import { generateCode } from "~/modules/qr/utils.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, parseData, payload } from "~/utils/http.server";
import { MAX_LABELS_PER_PRINT } from "~/utils/label-sheets";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * QR pixel size requested for print.
 *
 * `generateQrObj` hardcodes `medium` (116 px), which is sized for a screen
 * preview. A 30 mm printed QR at 300 dpi is ~354 px, so `large` (174 px) is the
 * closest available and upscales least. The renderer pairs this with
 * `image-rendering: pixelated` so the module edges stay square instead of being
 * smoothed into something a scanner has to work at (AC6).
 */
const PRINT_QR_SIZE = "large" as const;

const querySchema = z.object({
  entity: z.enum(["asset", "kit"]),
});

/** One printable label's worth of data. */
export type PrintableLabelItem = {
  id: string;
  /** Asset title or kit name — whichever this entity calls it. */
  title: string;
  /** Assets may carry a SAM id; kits have no such field today. */
  sequentialId: string | null;
  qr: {
    id: string;
    src: string;
    size: "small" | "cable" | "medium" | "large";
  };
};

/** What {@link loader} resolves to. */
export type PrintLabelsLoaderData = {
  items: PrintableLabelItem[];
  /** Workspace preference deciding whether the SAM id or the QR id is shown. */
  qrIdDisplayPreference: string;
  /** Selected items that had no QR code and were left out — surfaced, not hidden. */
  skippedCount: number;
};

/**
 * Resolves the selection and returns label data for it.
 *
 * Permission is `qr:read` — the same gate the QR download uses. Printing a
 * label discloses nothing the list itself does not already show, so any role
 * that can read the items can print them (US-001 § Permissions).
 *
 * Error cases:
 * - 400 no ids supplied, or an unknown `entity`
 * - 400 more than {@link MAX_LABELS_PER_PRINT} items resolved
 * - 403 role lacks `qr:read`
 *
 * @returns {@link PrintLabelsLoaderData}
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.qr,
      action: PermissionAction.read,
    });

    const url = new URL(request.url);
    const searchParams = url.searchParams;

    /**
     * `parseData`, not a bare `schema.parse` — a raw `ZodError` reaches
     * `makeShelfError` as an unrecognised cause and becomes a **500 that is
     * captured to Sentry**. An unknown `entity` is a bad request, not an
     * incident.
     */
    const { entity } = parseData(searchParams, querySchema, {
      message: "Labels can only be printed for assets or kits.",
      shouldBeCaptured: false,
    });

    const ids = searchParams.getAll("ids");

    if (ids.length === 0) {
      throw new ShelfError({
        cause: null,
        status: 400,
        message: "No items were selected to print.",
        shouldBeCaptured: false,
        label: "QR",
      });
    }

    const selectingAll = ids.includes(ALL_SELECTED_KEY);

    /**
     * Both branches are org-scoped: the filtered path through the shared
     * where-input builders, the explicit path by pairing the ids WITH
     * `organizationId` so a crafted id from another workspace matches nothing
     * (`.claude/rules/org-scope-user-supplied-ids.md`).
     */
    const rows =
      entity === "asset"
        ? await db.asset.findMany({
            where: selectingAll
              ? getAssetsWhereInput({
                  organizationId,
                  currentSearchParams: searchParams.toString(),
                })
              : ({
                  id: { in: ids },
                  organizationId,
                } satisfies Prisma.AssetWhereInput),
            select: { id: true, title: true, sequentialId: true },
            orderBy: { createdAt: "asc" },
          })
        : (
            await db.kit.findMany({
              where: selectingAll
                ? getKitsWhereInput({
                    organizationId,
                    currentSearchParams: searchParams.toString(),
                  })
                : ({
                    id: { in: ids },
                    organizationId,
                  } satisfies Prisma.KitWhereInput),
              select: { id: true, name: true },
              orderBy: { createdAt: "asc" },
            })
          ).map((kit) => ({
            id: kit.id,
            title: kit.name,
            // Kits have no `sequentialId` column, so they always fall back to
            // the QR id regardless of the workspace preference.
            sequentialId: null as string | null,
          }));

    if (rows.length > MAX_LABELS_PER_PRINT) {
      throw new ShelfError({
        cause: null,
        status: 400,
        message: `Printing is limited to ${MAX_LABELS_PER_PRINT} labels at a time. You selected ${rows.length}. Narrow the selection and print in batches.`,
        shouldBeCaptured: false,
        label: "QR",
      });
    }

    const rowIds = rows.map((row) => row.id);

    /**
     * One query for every QR, rather than one query per item. `organizationId`
     * is on the `Qr` row itself, so this is scoped independently of how the
     * items were resolved.
     */
    const qrRows = await db.qr.findMany({
      where:
        entity === "asset"
          ? { organizationId, assetId: { in: rowIds } }
          : { organizationId, kitId: { in: rowIds } },
      select: {
        id: true,
        version: true,
        errorCorrection: true,
        assetId: true,
        kitId: true,
      },
      orderBy: { createdAt: "asc" },
    });

    /**
     * An item can own more than one QR (a relink leaves the old row behind).
     * The oldest is the one printed on any existing label, so `orderBy` above
     * plus "first write wins" here keeps a reprint matching what is already
     * stuck to the item.
     */
    const qrByOwner = new Map<string, (typeof qrRows)[number]>();
    for (const qrRow of qrRows) {
      const ownerId = entity === "asset" ? qrRow.assetId : qrRow.kitId;
      if (ownerId && !qrByOwner.has(ownerId)) {
        qrByOwner.set(ownerId, qrRow);
      }
    }

    const items: PrintableLabelItem[] = [];
    let skippedCount = 0;

    for (const row of rows) {
      const qrRow = qrByOwner.get(row.id);

      // No QR: leave it out and count it. Never create one — this is a GET.
      if (!qrRow) {
        skippedCount += 1;
        continue;
      }

      const { code } = await generateCode({
        // Prisma's own column types, narrowed to the qrcode-generator unions —
        // the same casts the single-QR path uses.
        version: qrRow.version as TypeNumber,
        errorCorrection: qrRow.errorCorrection as ErrorCorrectionLevel,
        size: PRINT_QR_SIZE,
        qr: { id: qrRow.id },
      });

      items.push({
        id: row.id,
        title: row.title,
        sequentialId: row.sequentialId,
        qr: code,
      });
    }

    return data(
      payload({
        items,
        qrIdDisplayPreference: currentOrganization.qrIdDisplayPreference,
        skippedCount,
      } satisfies PrintLabelsLoaderData)
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
