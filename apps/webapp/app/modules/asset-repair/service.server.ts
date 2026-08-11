/**
 * Asset Repair Service — the WRITE path (US-001).
 *
 * Creating a fault report takes an individually-tracked asset out of service.
 * "Out of service" is not stored on the asset: it is derived from this table by
 * `./availability.server.ts`, whose single predicate is `closedAt IS NULL`
 * (`DECISIONS.md` #31). Nothing here writes `Asset.availableToBook` — a repair
 * OVERRIDES that flag and never mutates it (`DECISIONS.md` #22).
 *
 * Kept separate from `./availability.server.ts` on purpose: the booking
 * services import only the read-only guard, so they never pull in the note /
 * activity-event helpers this module needs (which would be an import cycle).
 *
 * There is deliberately NO quantity dimension on a repair (`DECISIONS.md` #2).
 * One repair = one asset. "How many are available" is counted, never stored, so
 * `.claude/rules/quantity-semantics-per-surface.md` never comes into play here.
 *
 * @see {@link file://./availability.server.ts} the booking guard
 * @see {@link file://./schema.ts} the request payload schema
 * @see {@link file://./../../routes/_layout+/assets.$assetId_.report-fault.tsx}
 */

import type { AssetRepair } from "@prisma/client";
import { AssetType, Prisma } from "@prisma/client";

import { db } from "~/database/db.server";
import { createNotes } from "~/modules/note/service.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import {
  appendUserTextToNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import { assertAssetsBelongToOrg } from "~/utils/org-validation.server";

const label = "Asset Repair" as const;

/**
 * The refusal for a fault report against a `QUANTITY_TRACKED` asset.
 *
 * `DECISIONS.md` #17 — Neil DEFERRED the product rule for quantity-tracked
 * assets; #23 makes the code's fallback a statement of CAPABILITY, never of
 * policy. Do not grow this into "because a repair applies to the whole pool" or
 * "not yet supported": both assert a rule that has not been taken. If a QT
 * fault report is ever wanted, it is a new question for Neil and a new story.
 */
export const QUANTITY_TRACKED_REPAIR_MESSAGE =
  "Fault reports are recorded against individually-tracked assets.";

/** Snapshot of a user persisted alongside a repair, mirroring `ActivityEvent.actorSnapshot`. */
type UserSnapshot = {
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
};

type ReportAssetFaultArgs = {
  /**
   * User-supplied: arrives from the URL. Proven to belong to `organizationId`
   * inside the transaction before anything is written
   * (`.claude/rules/org-scope-user-supplied-ids.md`).
   */
  assetId: string;
  /** From the session — NEVER from the request. Required, so the compiler forces every call site. */
  organizationId: string;
  /** The reporter. Recorded on the repair and used as the note's author. */
  userId: string;
  /** Free text as typed. Sanitised before it reaches note content. */
  faultDescription: string;
};

/**
 * Reports a fault against an asset, taking it out of the bookable pool.
 *
 * Everything commits atomically: the org-scope guard, the repair row and the
 * system note share one transaction, so a failure anywhere leaves no partial
 * record (US-001 AC6 — "nothing is written if the transaction rolls back").
 *
 * **One open repair per asset (AC5) is enforced by the database**, not by a
 * pre-read: the partial unique index `AssetRepair_assetId_open_key`
 * (`ON "AssetRepair"("assetId") WHERE "closedAt" IS NULL`) means two people
 * submitting in the same second produce one commit and one `P2002`, which is
 * translated below into a 400 pointing at the existing report. A pre-read
 * cannot make that promise — both readers would see "no open repair"
 * (`DECISIONS.md` #24).
 *
 * @param args.assetId - Asset to report against (user-supplied, org-checked)
 * @param args.organizationId - Caller's session organization
 * @param args.userId - Reporting user
 * @param args.faultDescription - Trimmed, non-empty symptom description
 * @returns The created `AssetRepair` row
 * @throws {ShelfError} 404 if the asset is not in the caller's organization —
 *   deliberately non-disclosing, it never echoes the other org's asset title (AC8)
 * @throws {ShelfError} 400 if the asset is `QUANTITY_TRACKED` (AC9 / #23)
 * @throws {ShelfError} 400 if the asset already has an open fault report (AC5)
 */
export async function reportAssetFault({
  assetId,
  organizationId,
  userId,
  faultDescription,
}: ReportAssetFaultArgs): Promise<AssetRepair> {
  try {
    return await db.$transaction(async (tx) => {
      /**
       * Read first so a foreign / missing asset yields a NON-DISCLOSING 404
       * (AC8) rather than leaking through a message shaped around the other
       * organization's data. The read is itself org-scoped, so it can only ever
       * return this workspace's row.
       */
      const asset = await tx.asset.findFirst({
        where: { id: assetId, organizationId },
        select: { id: true, title: true, type: true },
      });

      if (!asset) {
        throw new ShelfError({
          cause: null,
          label,
          status: 404,
          shouldBeCaptured: false,
          title: "Asset not found",
          message:
            "Asset not found. Are you sure it exists in your current workspace?",
          // Deliberately no `assetId` echo in the message — see AC8.
          additionalData: { assetId, organizationId },
        });
      }

      /**
       * SECURITY (cross-org IDOR): `assetId` came from the URL and is about to
       * be written onto a new row. The shared guard is the authoritative
       * ownership assertion — `.claude/rules/org-scope-user-supplied-ids.md`
       * is explicit that this must not be a hand-rolled inline check, and that
       * CREATE paths need it just as much as edit paths. Runs with the active
       * `tx` so it commits atomically with the insert.
       */
      await assertAssetsBelongToOrg(
        { assetIds: [assetId], organizationId },
        tx
      );

      /**
       * The ONE place in this feature that consults `AssetType`
       * (`DECISIONS.md` #23). The affordance is not rendered for
       * quantity-tracked assets; this rejects a directly-submitted POST.
       */
      if (asset.type === AssetType.QUANTITY_TRACKED) {
        throw new ShelfError({
          cause: null,
          label,
          status: 400,
          shouldBeCaptured: false,
          title: "Can't report a fault here",
          message: QUANTITY_TRACKED_REPAIR_MESSAGE,
          additionalData: { assetId, organizationId },
        });
      }

      const reporter = await tx.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true, displayName: true },
      });

      const reporterSnapshot: UserSnapshot | null = reporter
        ? {
            firstName: reporter.firstName,
            lastName: reporter.lastName,
            displayName: reporter.displayName,
          }
        : null;

      const repair = await tx.assetRepair.create({
        data: {
          assetId,
          organizationId,
          faultDescription,
          reportedById: userId,
          // `reportedById` is `ON DELETE SET NULL`, so the name has to be
          // captured now or the history renders anonymously later.
          reporterSnapshot: reporterSnapshot ?? Prisma.DbNull,
        },
      });

      /**
       * System note for the asset's activity feed (US-001 AC6).
       *
       * `faultDescription` is user-typed free text spliced into content that is
       * rendered through Markdoc, so a raw `{% … %}` would become a live tag —
       * a stored XSS. `appendUserTextToNote` strips the delimiters with the
       * repeat-until-stable helper; never hand-roll a single-pass strip
       * (`.claude/rules/sanitize-note-content-markdoc.md`). The asset title is
       * NOT spliced here at all, so there is no second injection point.
       */
      const actor = wrapUserLinkForNote({
        id: userId,
        firstName: reporter?.firstName ?? null,
        lastName: reporter?.lastName ?? null,
        displayName: reporter?.displayName ?? null,
      });

      await createNotes(
        {
          content: appendUserTextToNote(
            `${actor} reported a fault. This item is out of action and cannot be booked or checked out until the repair is marked complete.`,
            faultDescription
          ),
          type: "UPDATE",
          userId,
          assetIds: [assetId],
          organizationId,
        },
        tx
      );

      /**
       * ⚠️ MISSING: the structured `ActivityEvent` row required by US-001 AC6.
       *
       * `recordEvent({ action: "ASSET_REPAIR_REPORTED", entityType: "ASSET",
       * entityId: assetId, assetId, meta: { repairId: repair.id } }, tx)`
       * belongs HERE, inside this transaction
       * (`.claude/rules/use-record-event.md`).
       *
       * It cannot be written yet: `ActivityAction` has no `ASSET_REPAIR_*`
       * values, and the enum lives in `packages/database/prisma/schema.prisma`,
       * which the backend developer does not own. `progress.md` §3.6 sequenced
       * the addition; the migration that landed did not include it. Tracked in
       * the handoff — `shelf-database-specialist` adds
       * `ASSET_REPAIR_REPORTED` / `ASSET_REPAIR_CLOSED`, then this becomes a
       * five-line change.
       */

      return repair;
    });
  } catch (cause) {
    /**
     * The partial unique index fired: someone else's open report for this asset
     * already exists (or landed microseconds earlier). This is the AC5
     * guarantee arriving — surface it as an expected 400, not a 500.
     */
    if (isOpenRepairUniqueViolation(cause)) {
      throw new ShelfError({
        cause,
        label,
        status: 400,
        shouldBeCaptured: false,
        title: "Already reported",
        message:
          // why: `shelf-ux-designer` ruling (DECISIONS.md canonical #115). Three
          // deliberate choices here: "item" not "asset" (the prose noun fixed in
          // design.md §2); no "open the asset to see it" (this surface has no
          // such affordance); and it states that the typed description was
          // discarded, which is the only thing the user still needs to know.
          // It does NOT say "someone else" — a user whose own report landed in a
          // second tab hits this same P2002.
          // The substring "already has an open fault report" is load-bearing:
          // service.server.test.ts asserts on it.
          "This item already has an open fault report, so it's out of action. Your description wasn't saved — there's nothing else you need to do.",
        additionalData: { assetId, organizationId },
      });
    }

    /**
     * Re-throw our own refusals untouched. `ShelfError` overwrites `message`
     * with the wrapper's, so re-wrapping would replace the 404 / QT / org-scope
     * copy with the generic sentence below while keeping its status — an error
     * whose code and text disagree.
     */
    if (isLikeShelfError(cause)) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      label,
      message:
        "Something went wrong while reporting the fault. Please try again or contact support.",
      additionalData: { assetId, organizationId, userId },
    });
  }
}

/**
 * Is this the `AssetRepair_assetId_open_key` partial unique index rejecting a
 * second open repair?
 *
 * Matches on the Prisma error code only. The index name is checked when Prisma
 * supplies it, but is not required: for a raw-SQL partial unique, `meta.target`
 * shape has varied across Prisma versions, and no OTHER unique constraint
 * exists on `AssetRepair` for this to be confused with (the primary key is the
 * only other one, and a `cuid()` collision is not a real failure mode).
 *
 * @param cause - The thrown value from the transaction
 * @returns `true` when the cause is a unique-constraint violation on `AssetRepair`
 */
function isOpenRepairUniqueViolation(cause: unknown): boolean {
  return (
    cause instanceof Prisma.PrismaClientKnownRequestError &&
    cause.code === "P2002"
  );
}
