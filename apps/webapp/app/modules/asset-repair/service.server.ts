/**
 * Asset Repair Service — the report (US-001), close (US-005) and workspace
 * out-of-action list (US-003).
 *
 * Creating a fault report takes an individually-tracked asset out of service;
 * closing the repair is what puts it back. "Out of service" is not stored on
 * the asset: it is derived from this table by `./availability.server.ts`, whose
 * single predicate is `closedAt IS NULL` (`DECISIONS.md` #31). Nothing here
 * writes `Asset.availableToBook` — a repair OVERRIDES that flag and never
 * mutates it (`DECISIONS.md` #22). That is why {@link closeAssetRepair} touches
 * one column on one row and the asset becomes bookable again with no second
 * write anywhere (US-005 AC2/AC3).
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
 * @see {@link file://./schema.ts} the request payload schemas
 * @see {@link file://./../../routes/_layout+/assets.$assetId_.report-fault.tsx}
 * @see {@link file://./../../routes/_layout+/assets.$assetId.repairs.$repairId.close.tsx}
 * @see {@link file://./../../routes/_layout+/repairs._index.tsx}
 */

import type { AssetRepair } from "@prisma/client";
import type { RepairOutcome } from "@prisma/client";
import type { RepairStatus } from "@prisma/client";
import {
  AssetType,
  Prisma,
  RepairStatus as RepairStatusEnum,
} from "@prisma/client";

import { db } from "~/database/db.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import type { EntityForCodeResolution } from "~/modules/barcode/display";
import { ASSET_CODE_RESOLUTION_SELECT } from "~/modules/barcode/display";
import { createNotes } from "~/modules/note/service.server";

import { isLikeShelfError, ShelfError } from "~/utils/error";
import {
  appendUserTextToNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import { assertAssetsBelongToOrg } from "~/utils/org-validation.server";
import { resolveUserDisplayName } from "~/utils/user";

import type { RepairHistoryState } from "./history-state";
import { resolveRepairHistoryState } from "./history-state";
import {
  notifyFaultReported,
  warnBookingsAssetWrittenOff,
} from "./notifications.server";
import type { RepairListFilter } from "./schema";
import { DEFAULT_REPAIR_LIST_FILTER } from "./schema";

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
    /**
     * The transaction returns the repair AND the couple of fields the
     * post-commit notification needs, so the fan-out does not re-read the asset
     * or the reporter. Returned rather than assigned to an outer `let`: a
     * mutable variable written inside a callback defeats TypeScript's control
     * flow analysis, which then narrows it to `never` after the await.
     */
    const { repair, notification } = await db.$transaction(async (tx) => {
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
       * The structured audit row (US-001 AC6), written INSIDE this transaction
       * so it cannot survive a rollback (`.claude/rules/use-record-event.md`).
       *
       * The entity is the **asset**, not the repair: "this item went out of
       * service" is what the asset's activity feed and every report asks
       * about, and a repair id means nothing to either. The repair id rides in
       * `meta` for anyone who needs to correlate.
       */
      await recordEvent(
        {
          organizationId,
          actorUserId: userId,
          action: "ASSET_REPAIR_REPORTED",
          entityType: "ASSET",
          entityId: assetId,
          assetId,
          meta: { repairId: repair.id },
        },
        tx
      );

      return {
        repair,
        notification: {
          assetTitle: asset.title,
          reporterName: resolveUserDisplayName(reporter) || "Someone",
        },
      };
    });

    /**
     * ⚠️ POST-COMMIT, and deliberately so (US-009 AC3/AC4, US-011 AC5/AC6).
     *
     * Two requirements point in opposite directions and only this position
     * satisfies both: a mail failure must not roll back a repair that was
     * correctly recorded, and a rolled-back transaction must not leave an email
     * already sent. Inside the tx would break the first; before it, the second.
     *
     * `notifyFaultReported` never throws — it swallows and logs — so this is
     * safe to await without a guard of its own. It is awaited rather than
     * fired-and-forgotten so the request does not end mid-send, and because a
     * floating promise here would be invisible to the tests.
     */
    await notifyFaultReported({
      assetId,
      assetTitle: notification.assetTitle,
      faultDescription,
      organizationId,
      reporterUserId: userId,
      reporterName: notification.reporterName,
    });

    return repair;
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
 * The refusal shown when the close lost the race — the repair was already
 * closed by someone else, another tab, or a replayed request (US-005 AC6).
 *
 * Copy is `design.md` §8's "Already closed (400)" row verbatim. It must stay
 * recognisably DIFFERENT from the written-off refusal US-008 adds here
 * (US-005 AC11): they are different states and the user is told which one they
 * hit.
 */
export const REPAIR_ALREADY_CLOSED_MESSAGE =
  "This fault report was already closed — someone got there first. Close this and refresh.";

/**
 * The non-disclosing refusal for a repair id that does not resolve inside the
 * caller's workspace (US-005 AC7).
 *
 * One message for "no such repair", "another organisation's repair" and "that
 * repair belongs to a different asset", deliberately: distinguishing them would
 * confirm to an attacker that an id exists somewhere else, which is exactly
 * what AC7 forbids. It also never echoes the other workspace's asset title or
 * fault text.
 */
export const REPAIR_NOT_FOUND_MESSAGE = "We couldn't find that fault report.";

/**
 * The refusal for trying to mark a WRITTEN-OFF repair as repaired (US-005 AC11,
 * US-008 AC5).
 *
 * Must stay recognisably different from {@link REPAIR_ALREADY_CLOSED_MESSAGE}:
 * "someone got there first" and "this item is not coming back" are different
 * facts, and the person reading it needs to know which one they hit.
 */
export const REPAIR_WRITTEN_OFF_MESSAGE =
  "This item was written off, so it can't be returned to service.";

type CloseAssetRepairArgs = {
  /**
   * User-supplied: arrives from the URL. Both this AND `repairId` are proven to
   * belong to `organizationId` before anything is written
   * (`.claude/rules/org-scope-user-supplied-ids.md`).
   */
  assetId: string;
  /**
   * User-supplied: arrives from the URL. Never trusted to belong to `assetId`
   * either — the pairing is part of the compare-and-set's `where`, because the
   * note below is written against `assetId` and a mismatched pair would file
   * the closure on the wrong asset's history.
   */
  repairId: string;
  /** From the session — NEVER from the request. Required, so the compiler forces every call site. */
  organizationId: string;
  /** The lead closing the repair. Recorded on the row and used as the note's author. */
  userId: string;
  /** Optional "what was done" free text. Sanitised before it reaches note content. */
  resolutionNote?: string;
};

/** What the route needs after a successful close — enough for the toast, nothing more. */
type CloseAssetRepairResult = {
  repairId: string;
  assetId: string;
  /** For `design.md` §8's success toast: "{Asset title} can be booked again." */
  assetTitle: string;
  closedAt: Date;
};

/**
 * Closes an open repair, returning the asset to the bookable pool (US-005).
 *
 * **The close is an atomic compare-and-set, never a pre-read** (`DECISIONS.md`
 * #25). `updateMany` with `closedAt: null` in the `where` means the database
 * decides the winner: two leads clicking at the same moment produce exactly one
 * row update and one `count === 0`, which is the 400 (AC6). A read-then-write
 * cannot promise that — both readers would see an open repair and both would
 * write, producing two notes, two activity events and a second `closedAt`.
 *
 * `count === 0` is resolved into a specific refusal on the FAILURE PATH ONLY
 * (see {@link buildCloseRefusal}). The operation has already failed by then, so
 * there is no race left to lose, and the happy path keeps its single round trip
 * for the state check.
 *
 * Nothing here writes `Asset.availableToBook` or `Asset.status`
 * (`DECISIONS.md` #22, #21): bookability is derived from `closedAt IS NULL` and
 * only that (#31), so stamping the column IS the return to service. That also
 * means an asset an admin had manually parked stays parked, and an asset that
 * went into custody or joined a kit while out of action keeps that state
 * (AC3 — derive, do not set).
 *
 * @param args.assetId - Asset the repair belongs to (user-supplied, org-checked)
 * @param args.repairId - Repair to close (user-supplied, org-checked)
 * @param args.organizationId - Caller's session organization
 * @param args.userId - The closing user (`OWNER`/`ADMIN`, enforced on the route)
 * @param args.resolutionNote - Optional free text; stored and quoted in the note
 * @returns Identifiers plus the asset title, for the success toast
 * @throws {ShelfError} 404 when the asset or the repair does not resolve inside
 *   the caller's organization, or the two do not belong together — deliberately
 *   non-disclosing (AC7)
 * @throws {ShelfError} 400 when the repair is already closed (AC6)
 */
export async function closeAssetRepair({
  assetId,
  repairId,
  organizationId,
  userId,
  resolutionNote,
}: CloseAssetRepairArgs): Promise<CloseAssetRepairResult> {
  try {
    return await db.$transaction(async (tx) => {
      /**
       * Org-scoped read of the asset. Serves three jobs: the non-disclosing 404
       * (AC7), the "asset was deleted while in repair" edge case (refuse
       * cleanly rather than write a note against a dead row), and the title the
       * success toast needs. It is NOT a pre-read of the repair's state — that
       * would be the thing #25 forbids.
       */
      const asset = await tx.asset.findFirst({
        where: { id: assetId, organizationId },
        select: { id: true, title: true },
      });

      if (!asset) {
        throw new ShelfError({
          cause: null,
          label,
          status: 404,
          shouldBeCaptured: false,
          title: "Fault report not found",
          message: REPAIR_NOT_FOUND_MESSAGE,
          additionalData: { assetId, repairId, organizationId },
        });
      }

      /**
       * SECURITY (cross-org IDOR): `assetId` came from the URL. The shared
       * guard is the authoritative ownership assertion —
       * `.claude/rules/org-scope-user-supplied-ids.md` is explicit that this
       * must not be a hand-rolled inline check. Runs with the active `tx` so it
       * commits atomically with the update. The `organizationId` inside the
       * compare-and-set below is part of the same protection for `repairId`,
       * not a substitute for this call.
       */
      await assertAssetsBelongToOrg(
        { assetIds: [assetId], organizationId },
        tx
      );

      /**
       * Read BEFORE the compare-and-set because the snapshot is part of the
       * `data` it writes. Reading a user is not reading repair state, so this
       * does not weaken the CAS.
       */
      const closer = await tx.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true, displayName: true },
      });

      const closerSnapshot: UserSnapshot | null = closer
        ? {
            firstName: closer.firstName,
            lastName: closer.lastName,
            displayName: closer.displayName,
          }
        : null;

      const closedAt = new Date();

      const { count } = await tx.assetRepair.updateMany({
        where: {
          id: repairId,
          // Org-scope in the SAME statement as the write (AC7).
          organizationId,
          // The URL's asset must be this repair's asset: the note, the activity
          // event and the return to service all key off `assetId`.
          assetId,
          /**
           * The compare-and-set. `closedAt IS NULL` is both "still open" and,
           * per #31, the whole bookability rule — so this condition is what
           * makes closing twice impossible (AC6).
           */
          closedAt: null,
          /**
           * ✅ US-008 added this (`DECISIONS.md` #38, US-005 AC11).
           *
           * **Without it, "mark repaired" returns SCRAPPED GEAR to the bookable
           * pool.** A written-off repair deliberately keeps `closedAt = NULL`
           * for ever (#37) — that is what keeps the asset out of the pool
           * through the ordinary guard — so `closedAt: null` alone MATCHES a
           * written-off repair. Each decision is correct alone and wrong beside
           * the other; this second condition is the fix, and the written-off
           * branch in `buildCloseRefusal` below is its other half.
           */
          outcome: null,
        },
        data: {
          closedAt,
          closedById: userId,
          // `closedById` is `ON DELETE SET NULL`, so the name has to be
          // captured now or the history renders anonymously later.
          closerSnapshot: closerSnapshot ?? Prisma.DbNull,
          // `undefined` would mean "leave unchanged"; the column is nullable and
          // this row was open, so an omitted note is explicitly NULL.
          resolutionNote: resolutionNote ?? null,
        },
      });

      if (count === 0) {
        throw await buildCloseRefusal(
          { assetId, repairId, organizationId },
          tx
        );
      }

      /**
       * System note for the asset's activity feed (US-005 AC5). Written in the
       * same transaction as the closure, so a rollback leaves neither.
       *
       * `resolutionNote` is user-typed free text spliced into content that is
       * rendered through Markdoc, so a raw `{% … %}` would become a live tag —
       * a stored XSS. `appendUserTextToNote` strips the delimiters with the
       * repeat-until-stable helper; never hand-roll a single-pass strip
       * (`.claude/rules/sanitize-note-content-markdoc.md`, AC10). The asset
       * title is NOT spliced here at all, so there is no second injection point.
       */
      const actor = wrapUserLinkForNote({
        id: userId,
        firstName: closer?.firstName ?? null,
        lastName: closer?.lastName ?? null,
        displayName: closer?.displayName ?? null,
      });

      await createNotes(
        {
          content: appendUserTextToNote(
            `${actor} marked this repaired. It's back in the pool and can be booked again.`,
            resolutionNote
          ),
          type: "UPDATE",
          userId,
          assetIds: [assetId],
          organizationId,
        },
        tx
      );

      /**
       * The structured audit row (US-005 AC5), inside this transaction so a
       * rollback cannot leave an event for a closure that never happened
       * (`.claude/rules/use-record-event.md`).
       *
       * Its OWN action, never a shared "repair updated" umbrella, so "how many
       * did we return to service this quarter" stays a `groupBy` and never
       * becomes JSON parsing
       * (`.claude/rules/record-event-payload-shapes.md`).
       */
      await recordEvent(
        {
          organizationId,
          actorUserId: userId,
          action: "ASSET_REPAIR_CLOSED",
          entityType: "ASSET",
          entityId: assetId,
          assetId,
          meta: { repairId },
        },
        tx
      );

      return {
        repairId,
        assetId,
        assetTitle: asset.title,
        closedAt,
      };
    });
  } catch (cause) {
    /**
     * Re-throw our own refusals untouched — `ShelfError` overwrites `message`,
     * so re-wrapping would keep the 400/404 status while replacing its copy
     * with the generic sentence below.
     */
    if (isLikeShelfError(cause)) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      label,
      message:
        "Something went wrong while marking this repaired. Please try again or contact support.",
      additionalData: { assetId, repairId, organizationId, userId },
    });
  }
}

/**
 * The single read {@link buildCloseRefusal} needs, expressed structurally so
 * both the extended top-level client and an interactive transaction client
 * satisfy it — the same approach as `AssetRepairAvailabilityTxClient` and
 * `OrgValidationTxClient`.
 */
type CloseRefusalTxClient = {
  assetRepair: {
    findFirst: (args: {
      where: { id: string; organizationId: string };
      select: {
        id: true;
        assetId: true;
        closedAt: true;
        // US-008: tells the written-off refusal from the already-closed one.
        outcome: true;
      };
    }) => Promise<{
      id: string;
      assetId: string;
      closedAt: Date | null;
      outcome: RepairOutcome | null;
    } | null>;
  };
};

/**
 * Works out WHY the compare-and-set matched nothing, and builds the refusal.
 *
 * **Failure path only.** By the time this runs the update has already matched
 * zero rows, so this read cannot introduce a race: there is no outcome left for
 * a concurrent writer to change. Calling anything like it BEFORE the update
 * would turn the atomic close into a read-then-write and lose AC6.
 *
 * @param args.assetId - Asset from the URL (already proven to be in the org)
 * @param args.repairId - Repair from the URL
 * @param args.organizationId - Caller's session organization
 * @param tx - The active transaction client
 * @returns The `ShelfError` the caller should throw
 */
async function buildCloseRefusal(
  {
    assetId,
    repairId,
    organizationId,
  }: { assetId: string; repairId: string; organizationId: string },
  tx: CloseRefusalTxClient
): Promise<ShelfError> {
  const repair = await tx.assetRepair.findFirst({
    // Org-scoped: a foreign repair id can only ever resolve to `null` here.
    where: { id: repairId, organizationId },
    select: { id: true, assetId: true, closedAt: true, outcome: true },
  });

  const additionalData = { assetId, repairId, organizationId };

  /**
   * Unknown id, another organisation's id, or an id that belongs to a
   * different asset — one message for all three (AC7). See
   * {@link REPAIR_NOT_FOUND_MESSAGE} for why they are not distinguished.
   */
  if (!repair || repair.assetId !== assetId) {
    return new ShelfError({
      cause: null,
      label,
      status: 404,
      shouldBeCaptured: false,
      title: "Fault report not found",
      message: REPAIR_NOT_FOUND_MESSAGE,
      additionalData,
    });
  }

  if (repair.closedAt) {
    return new ShelfError({
      cause: null,
      label,
      status: 400,
      // AC6: an expected business refusal (a stale tab, a double-click, a
      // replayed request), not an application error.
      shouldBeCaptured: false,
      title: "Already marked repaired",
      message: REPAIR_ALREADY_CLOSED_MESSAGE,
      additionalData,
    });
  }

  /**
   * ✅ US-008's branch, now live (`DECISIONS.md` #38, US-005 AC11).
   *
   * The repair is still open by `closedAt`, yet the CAS matched nothing — which
   * since US-008 means exactly one thing: it was WRITTEN OFF. Deliberately
   * different words from the already-closed refusal, because they are different
   * states and the user needs to know which one they hit.
   */
  if (repair.outcome) {
    return new ShelfError({
      cause: null,
      label,
      status: 400,
      // A business refusal, not an application error.
      shouldBeCaptured: false,
      title: "This item was written off",
      message: REPAIR_WRITTEN_OFF_MESSAGE,
      additionalData,
    });
  }

  /**
   * Open, not written off, and the CAS still matched nothing. That should be
   * unreachable, so it stays a CAPTURED 500: if it fires, the CAS and this
   * discrimination have drifted apart and someone needs to know.
   */
  return new ShelfError({
    cause: null,
    label,
    status: 500,
    title: "Couldn't mark this repaired",
    message:
      "Something went wrong while marking this repaired. Please reload the page and try again.",
    additionalData,
  });
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

/* -------------------------------------------------------------------------- *
 *  US-003 — the workspace out-of-action list                                  *
 * -------------------------------------------------------------------------- */

/** Milliseconds in a day, used to age a repair. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * "Open", and the whole of it: `closedAt IS NULL` (`DECISIONS.md` #31,
 * permanent). Every bucket below is ANDed with this, so a closed repair and a
 * reinstated one (US-012 stamps `closedAt`) both leave the list with no filter
 * change (#52). **Never add a second input to this.**
 */
const OPEN_REPAIR_WHERE = { closedAt: null } as const;

/**
 * The `awaiting` bucket — items waiting to be repaired.
 *
 * ✅ Real since US-008 (`DECISIONS.md` #39). This is the list someone checks
 * before a Sunday, so it must contain **no gear that is never coming back**
 * (AC10) — hence `outcome: null` rather than simply "open".
 */
const AWAITING_BUCKET_WHERE: Prisma.AssetRepairWhereInput = { outcome: null };

/**
 * The `written-off` bucket — items declared beyond repair.
 *
 * ✅ Real since US-008 (`DECISIONS.md` #39). Written-off repairs keep
 * `closedAt = NULL` for ever (#37), which is why they need their own bucket
 * rather than simply dropping off an "open" list.
 *
 * `{ outcome: { not: null } }` rather than `{ outcome: WRITTEN_OFF }`: the enum
 * has one member today, and matching "any outcome" means a second member (lost?
 * stolen?) appears here automatically rather than silently vanishing from every
 * bucket.
 */
const WRITTEN_OFF_BUCKET_WHERE: Prisma.AssetRepairWhereInput = {
  outcome: { not: null },
};

/**
 * The bucket half of the list's `where` clause.
 *
 * @param filter - The requested bucket (already degraded to a valid value)
 * @returns A `where` fragment to AND with the org + open predicate
 */
function repairBucketWhere(
  filter: RepairListFilter
): Prisma.AssetRepairWhereInput {
  switch (filter) {
    case "written-off":
      return WRITTEN_OFF_BUCKET_WHERE;
    // `all` is every OPEN repair — not every repair ever. The open predicate is
    // applied by the caller and is not a bucket concern.
    case "all":
      return {};
    case "awaiting":
      return AWAITING_BUCKET_WHERE;
  }
}

/** Arguments for {@link getOpenRepairsForOrganization}. */
type GetOpenRepairsForOrganizationArgs = {
  /**
   * From the session — **NEVER** from the request. Required, so the compiler
   * forces every call site to supply it, and no search param can widen the
   * scope (US-003 AC5, `.claude/rules/org-scope-user-supplied-ids.md`).
   */
  organizationId: string;
  /** 1-based page number. The route normalises junk before it gets here. */
  page: number;
  /** Rows per page. The route clamps this to the shared 1–100 range. */
  perPage: number;
  /** Raw `?s=` search term; comma-separated keywords are ORed. */
  search?: string | null;
  /** Bucket to show. Defaults to `awaiting` (`DECISIONS.md` #39). */
  filter?: RepairListFilter;
};

/**
 * One row of the out-of-action list.
 *
 * Flat on purpose: the row renders asset details but the entity is the
 * **repair**, so `id` is the repair id (that is what the `Mark repaired` action
 * posts to) and every asset field is prefixed. The one nested member,
 * {@link RepairListItem.assetCode}, is the exact input
 * `resolveDisplayCode` wants — passing the fields separately would invite a
 * re-implementation of the resolver
 * (`.claude/rules/code-bearing-entity-list-consistency.md`).
 */
export type RepairListItem = {
  /** The `AssetRepair` id — the row's identity, and what US-005's close posts to. */
  id: string;
  /** The faulty asset, for the row link and the `Mark repaired` dialog. */
  assetId: string;
  /** `Deleted item` is a UI fallback; a title is always present here (`onDelete: Cascade`). */
  assetTitle: string;
  /** Full-size image path. Present for the preview variant of `AssetImage`. */
  assetMainImage: string | null;
  /** What a list row should actually render — `<AssetImage useThumbnail>`. */
  assetThumbnailImage: string | null;
  /** Input for `resolveDisplayCode({ entity, organization })` — never rendered raw. */
  assetCode: EntityForCodeResolution;
  /**
   * The symptom as typed by the reporter. **Plain user text: render it as
   * text.** It is never passed through `MarkdownViewer` on this surface, so no
   * Markdoc sanitisation applies here — that rule governs note *content*
   * (`.claude/rules/sanitize-note-content-markdoc.md`), which this is not.
   */
  faultDescription: string;
  /** When the fault was reported. Render with `DateS` (US-003 AC2). */
  reportedAt: Date;
  /** Reporter's name, or `Unknown` when the user was deleted and no snapshot survives. */
  reporterName: string;
  /**
   * Whole days elapsed since `reportedAt` (`0` = reported in the last 24h).
   *
   * Computed server-side so every row on a page is aged against the same
   * instant, and so the number cannot drift while the page sits open.
   */
  daysOutOfAction: number;
  /**
   * **Always `false` until US-008.** Kept in the payload from day one so the
   * status cell (`design.md` D3) branches on the row rather than on the bucket
   * — which is what makes the `all` bucket possible without a rewrite.
   */
  isWrittenOff: boolean;
};

/** What {@link getOpenRepairsForOrganization} returns. */
type OpenRepairsResult = {
  /** The requested page, longest-out-of-action first. */
  items: RepairListItem[];
  /** Total rows in the ACTIVE bucket under the active search — drives pagination. */
  totalItems: number;
  /**
   * Row counts per bucket, for the switcher's `Awaiting repair (7)` labels.
   *
   * Computed under the **same search** as the list, differing only in the
   * bucket: a count that ignored the search would promise seven rows and then
   * show two. `writtenOff` is `0` until US-008 (see
   * {@link WRITTEN_OFF_BUCKET_WHERE}).
   */
  counts: { awaiting: number; writtenOff: number };
};

/**
 * The workspace "what is out of action right now" list (US-003).
 *
 * **Sorted oldest-first** (`reportedAt ASC`, tie-broken by `id ASC`). The screen
 * answers "what has been broken longest" for someone planning around the gaps
 * before a service, so the most urgent row must be first; the `id` tiebreak
 * makes paging deterministic when two faults are reported in the same
 * millisecond. The composite index `AssetRepair(organizationId, closedAt,
 * reportedAt)` serves the ordering and the org+open filter together.
 *
 * **No N+1.** One `findMany` with a tight nested `select` for the asset (title,
 * thumbnail and the code-resolution fields), one `count` per bucket, and one
 * extra `count` only for the `all` bucket — three or four queries regardless of
 * how many rows the page holds. Nothing here reads per row, and the booking
 * guards (`getOpenRepairAssetIds` / `assertNoOpenRepairs`) are deliberately not
 * used: they answer a different question and must not appear on a render path.
 *
 * @param args.organizationId - Caller's session organization (never user input)
 * @param args.page - 1-based page number
 * @param args.perPage - Rows per page
 * @param args.search - Optional comma-separated keywords (item title or fault text)
 * @param args.filter - Bucket to show; defaults to `awaiting`
 * @returns The page of rows, the active bucket's total, and per-bucket counts
 * @throws {ShelfError} 500 if the query fails
 */
export async function getOpenRepairsForOrganization({
  organizationId,
  page,
  perPage,
  search,
  filter = DEFAULT_REPAIR_LIST_FILTER,
}: GetOpenRepairsForOrganizationArgs): Promise<OpenRepairsResult> {
  try {
    /**
     * The scope every query below shares. `organizationId` comes from the
     * session and is applied to the REPAIR row (not only to the joined asset),
     * so a repair belonging to another workspace can neither be listed nor
     * counted — including through the search, which only narrows (US-003 AC5).
     */
    const scopeWhere: Prisma.AssetRepairWhereInput = {
      organizationId,
      ...OPEN_REPAIR_WHERE,
      ...buildRepairSearchWhere(search),
    };

    const activeWhere: Prisma.AssetRepairWhereInput = {
      ...scopeWhere,
      ...repairBucketWhere(filter),
    };

    const skip = page > 1 ? (page - 1) * perPage : 0;

    const [rows, awaiting, writtenOff, allCount] = await Promise.all([
      db.assetRepair.findMany({
        where: activeWhere,
        take: perPage,
        skip,
        // Oldest first — see the function doc.
        orderBy: [{ reportedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          assetId: true,
          faultDescription: true,
          reportedAt: true,
          // US-008 — drives the per-row `isWrittenOff` flag so the `all` bucket
          // can mix both kinds down one status column with no second query.
          outcome: true,
          // `reportedById` is `ON DELETE SET NULL`; the snapshot is the fallback.
          reporterSnapshot: true,
          reportedBy: {
            select: { firstName: true, lastName: true, displayName: true },
          },
          asset: {
            select: {
              title: true,
              mainImage: true,
              thumbnailImage: true,
              // Tight by construction — the resolver's own fragment, not a
              // hand-rolled copy (`code-bearing-entity-list-consistency`).
              ...ASSET_CODE_RESOLUTION_SELECT,
            },
          },
        },
      }),
      db.assetRepair.count({
        where: { ...scopeWhere, ...repairBucketWhere("awaiting") },
      }),
      db.assetRepair.count({
        where: { ...scopeWhere, ...repairBucketWhere("written-off") },
      }),
      /**
       * `all` is the only bucket whose total is not one of the two counts we
       * already need. For `awaiting` / `written-off` the total IS that bucket's
       * count — same `where` object, built by the same call — so a fourth query
       * would be duplicated work, not a safety net.
       */
      filter === "all"
        ? db.assetRepair.count({ where: activeWhere })
        : Promise.resolve(null),
    ]);

    const now = Date.now();

    const items: RepairListItem[] = rows.map((repair) => ({
      id: repair.id,
      assetId: repair.assetId,
      assetTitle: repair.asset.title,
      assetMainImage: repair.asset.mainImage,
      assetThumbnailImage: repair.asset.thumbnailImage,
      assetCode: {
        sequentialId: repair.asset.sequentialId,
        preferredBarcodeId: repair.asset.preferredBarcodeId,
        qrCodes: repair.asset.qrCodes,
        barcodes: repair.asset.barcodes,
      },
      faultDescription: repair.faultDescription,
      reportedAt: repair.reportedAt,
      reporterName: resolveReporterName(repair),
      daysOutOfAction: daysSince(repair.reportedAt, now),
      /**
       * ✅ Real since US-008. A per-ROW flag rather than a per-bucket one, which
       * is what lets the `all` bucket mix both kinds down one status column
       * (`design.md` D3) with no second query.
       */
      // `!= null` (loose) on purpose: it catches BOTH null and undefined. A
      // strict `!== null` reports every row as written off whenever `outcome`
      // is absent rather than null — which is what a caller with a narrower
      // select would hand us, and would scrap the whole list visually.
      isWrittenOff: repair.outcome != null,
    }));

    return {
      items,
      totalItems:
        filter === "all"
          ? // Non-null whenever `filter === "all"` — the two are set together
            // above. `?? 0` keeps the type honest without a cast.
            allCount ?? 0
          : filter === "written-off"
          ? writtenOff
          : awaiting,
      counts: { awaiting, writtenOff },
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message:
        "Something went wrong while loading the repairs list. Please try again or contact support.",
      additionalData: { organizationId, page, perPage, filter },
    });
  }
}

/* -------------------------------------------------------------------------- *
 *  US-004 — one asset's fault history                                         *
 * -------------------------------------------------------------------------- */

/**
 * How many recent faults the Overview card shows (`design.md` §6.6). The tab
 * has the rest, and the count pill states the true total either way.
 */
export const FAULT_HISTORY_CARD_LIMIT = 3;

/**
 * The columns every history surface reads. One fragment, so the Repairs tab,
 * the Overview card and the close dialog can never drift into showing
 * different facts about the same repair.
 *
 * Both name FKs are `ON DELETE SET NULL`, so each live relation is paired with
 * its write-time snapshot — the history must still render for a reporter who
 * has since left the workspace (US-004 "Deleted reporter").
 */
const REPAIR_HISTORY_SELECT = {
  id: true,
  faultDescription: true,
  reportedAt: true,
  reporterSnapshot: true,
  reportedBy: {
    select: { firstName: true, lastName: true, displayName: true },
  },
  closedAt: true,
  closerSnapshot: true,
  closedBy: {
    select: { firstName: true, lastName: true, displayName: true },
  },
  resolutionNote: true,
  /**
   * US-008. `outcome` is what stops a written-off repair rendering as "open":
   * it keeps `closedAt = NULL` for ever (#37), so a two-way ternary on
   * `closedAt` would label scrapped gear "awaiting repair" — the one thing it
   * will never be (US-004 AC9, `DECISIONS.md` #51).
   */
  status: true,
  diagnosis: true,
  outcome: true,
  outcomeAt: true,
  outcomeActorSnapshot: true,
  outcomeBy: {
    select: { firstName: true, lastName: true, displayName: true },
  },
} satisfies Prisma.AssetRepairSelect;

/** A repair row as read by {@link REPAIR_HISTORY_SELECT}. */
type RepairHistoryRow = Prisma.AssetRepairGetPayload<{
  select: typeof REPAIR_HISTORY_SELECT;
}>;

/**
 * One row of an asset's fault history (US-004 AC1, AC2).
 *
 * Flat, and **never rewritten**: US-004 AC5 makes this the audit trail the
 * whole feature rests on, so no ending — closed, written off, or written off
 * and later reinstated — may blank or re-use any field here.
 */
export type AssetRepairHistoryItem = {
  /** The `AssetRepair` id. Stable across every surface; also US-005's close target. */
  id: string;
  /**
   * The symptom as typed by the reporter, verbatim (AC5).
   *
   * **Plain user text: render it as text.** It is never passed through
   * `MarkdownViewer` on any history surface, so the Markdoc rule
   * (`.claude/rules/sanitize-note-content-markdoc.md`) does not apply — that
   * governs note *content*, which this is not.
   */
  faultDescription: string;
  /** When the fault was reported. Render with `DateS` (never `toLocaleDateString`). */
  reportedAt: Date;
  /** Reporter's name, or `Unknown` when the user was deleted and no snapshot survives. */
  reporterName: string;
  /** `null` while the item is out of action (AC1's "open"). */
  closedAt: Date | null;
  /** Who marked it repaired (AC2). `null` on an open repair. */
  closerName: string | null;
  /** The optional "what was done" text captured at closure (US-005). */
  resolutionNote: string | null;
  /**
   * Whole days the item spent — or has so far spent — out of action (AC2).
   *
   * Measured `reportedAt → closedAt` for a repaired row and `reportedAt → now`
   * for an open one. **`null` for the two write-off states**: `closedAt −
   * reportedAt` is computable for a reinstated repair, but that number means
   * "how long the repair took" everywhere else in this feature, and the repair
   * never happened (`design.md` §17.4 decision 3). A fabricated statistic is
   * worse than a blank.
   */
  daysOutOfAction: number | null;
  /**
   * Which OPEN stage it is in (US-008). Meaningful only while `state` is
   * `"open"` — a closed or written-off repair keeps whatever stage it was last
   * in, which is history rather than current fact.
   */
  status: RepairStatus;
  /** What a lead found on the bench. `null` until someone records one. */
  diagnosis: string | null;
  /**
   * Which of the four states this repair renders as.
   *
   * Computed server-side through {@link resolveRepairHistoryState} so that the
   * single named helper US-004 AC9 requires is genuinely the only place the
   * branch exists — a component that re-derived it from `closedAt` would be
   * the drift the AC forbids.
   */
  state: RepairHistoryState;
};

/**
 * Maps a database row to a history item, computing the state and the duration.
 *
 * @param repair - A row read with {@link REPAIR_HISTORY_SELECT}
 * @param now - Milliseconds since the epoch, captured ONCE per request so every
 *   row on a page is aged against the same instant and cannot drift mid-render
 * @returns The renderable history item
 */
function toRepairHistoryItem(
  repair: RepairHistoryRow,
  now: number
): AssetRepairHistoryItem {
  /**
   * The one derivation (AC9). `outcome` and `reinstatedAt` are not selected
   * because the columns do not exist yet — the helper reads them as
   * `undefined` and returns the two reachable states. When US-008 / US-012 add
   * the columns, they are added to {@link REPAIR_HISTORY_SELECT} and nothing
   * here changes.
   */
  const state = resolveRepairHistoryState(repair);

  return {
    id: repair.id,
    faultDescription: repair.faultDescription,
    reportedAt: repair.reportedAt,
    reporterName: resolveReporterName(repair),
    closedAt: repair.closedAt,
    closerName: resolveCloserName(repair),
    resolutionNote: repair.resolutionNote,
    status: repair.status,
    diagnosis: repair.diagnosis,
    daysOutOfAction:
      state === "open"
        ? daysSince(repair.reportedAt, now)
        : state === "repaired" && repair.closedAt
        ? daysSince(repair.reportedAt, repair.closedAt.getTime())
        : // Written off / reinstated — see the field's doc.
          null,
    state,
  };
}

/**
 * Ordering for every history surface: **most recent first**, tie-broken by id.
 *
 * US-004 AC8 requires a documented tiebreak so two faults reported in the same
 * second cannot swap places between reloads — which would make pagination skip
 * or repeat a row. `id` is a `cuid()`, monotonic enough to be stable and, more
 * importantly, unique, which is all a tiebreak has to be.
 *
 * Note this is the **opposite** direction to `/repairs`
 * ({@link getOpenRepairsForOrganization}, oldest first): that screen answers
 * "what has been broken longest", this one answers "what happened to this
 * item, most recently". Both are deliberate; neither is a default.
 */
const REPAIR_HISTORY_ORDER_BY: Prisma.AssetRepairOrderByWithRelationInput[] = [
  { reportedAt: "desc" },
  { id: "desc" },
];

/** Arguments shared by the two history reads. */
type AssetRepairHistoryScope = {
  /** User-supplied: arrives from the URL. Proven to belong to the org before anything is read. */
  assetId: string;
  /** From the session — NEVER from the request. Required, so the compiler forces every call site. */
  organizationId: string;
};

/** What {@link getAssetRepairHistory} returns. */
type AssetRepairHistoryResult = {
  /** The requested page, most recent first. */
  items: AssetRepairHistoryItem[];
  /** Every fault ever recorded on this asset — drives pagination and AC3's count. */
  totalItems: number;
};

/**
 * One asset's complete fault history, paginated (US-004 AC1, AC2, AC8).
 *
 * **Org-scoped twice over.** `assertAssetsBelongToOrg` refuses an asset from
 * another workspace before any repair row is read (AC7), and the query itself
 * filters on `organizationId` as well as `assetId` — never on `assetId` alone
 * (`.claude/rules/org-scope-user-supplied-ids.md`, and the story says so in
 * those words). The guard's refusal deliberately echoes nothing: no fault
 * text, no reporter name, no asset title from the other organisation.
 *
 * Served by the existing `AssetRepair(assetId, closedAt)` index; no new index
 * is needed and none is added.
 *
 * @param args.assetId - Asset whose history to read (user-supplied, org-checked)
 * @param args.organizationId - Caller's session organization
 * @param args.page - 1-based page number (the route normalises junk first)
 * @param args.perPage - Rows per page (the route clamps the range)
 * @returns The page of history rows and the all-time total
 * @throws {ShelfError} 400 when the asset is not in the caller's organization (AC7)
 * @throws {ShelfError} 500 if the query fails
 */
export async function getAssetRepairHistory({
  assetId,
  organizationId,
  page,
  perPage,
}: AssetRepairHistoryScope & {
  page: number;
  perPage: number;
}): Promise<AssetRepairHistoryResult> {
  try {
    /**
     * SECURITY (cross-org IDOR): `assetId` came from the URL and is about to
     * select rows. The shared guard is the authoritative ownership assertion —
     * the rule is explicit that READ paths need it too, and that it must not be
     * hand-rolled inline. No `tx` is passed: there is no write to be atomic
     * with, and the `where` below re-applies the scope regardless.
     */
    await assertAssetsBelongToOrg({ assetIds: [assetId], organizationId });

    const where: Prisma.AssetRepairWhereInput = { assetId, organizationId };
    const skip = page > 1 ? (page - 1) * perPage : 0;

    const [rows, totalItems] = await Promise.all([
      db.assetRepair.findMany({
        where,
        take: perPage,
        skip,
        orderBy: REPAIR_HISTORY_ORDER_BY,
        select: REPAIR_HISTORY_SELECT,
      }),
      db.assetRepair.count({ where }),
    ]);

    const now = Date.now();

    return {
      items: rows.map((row) => toRepairHistoryItem(row, now)),
      totalItems,
    };
  } catch (cause) {
    // The org-scope refusal is a deliberate 400 — re-throw it untouched rather
    // than replacing its message with the generic sentence below.
    if (isLikeShelfError(cause)) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      label,
      message:
        "Something went wrong while loading this item's fault history. Please try again or contact support.",
      additionalData: { assetId, organizationId, page, perPage },
    });
  }
}

/** What {@link getAssetRepairSummary} returns. */
export type AssetRepairSummary = {
  /**
   * Every fault ever recorded on this asset, closed or not (AC3).
   *
   * This is the number that makes a repeat offender obvious "without opening a
   * sub-page or counting rows manually" — it rides on the asset **layout**
   * loader, so the `Repairs (4)` tab label carries it on every tab of the page
   * (`design.md` §11 item 8).
   */
  count: number;
  /** The {@link FAULT_HISTORY_CARD_LIMIT} most recent faults, for the Overview card. */
  recent: AssetRepairHistoryItem[];
  /**
   * The repair currently keeping this item out of the pool, enriched.
   *
   * Feeds the out-of-action panel's fault text and the close dialog's
   * "Reported fault" block (`design.md` §6.3, §8) — which shipped with US-005
   * but has been **unreachable** ever since, because no surface had this
   * payload to pass it.
   *
   * Derived from `recent[0]` rather than a third query: the partial unique
   * index `AssetRepair_assetId_open_key` makes a second open repair impossible,
   * so while one is open no newer repair can exist and the open one is always
   * the most recent row. Free, and true by construction.
   *
   * ⚠️ "Open" here is `closedAt IS NULL` — the bookability predicate (#31), not
   * the history state. Once US-008 lands `outcome`, a **written-off** repair
   * also satisfies it and will surface here; that is exactly what `design.md`
   * §11 item 10 wants, since the page must tell the danger panel from the
   * neutral one. Branch on `openRepair.state`, never on its presence alone.
   */
  openRepair: AssetRepairHistoryItem | null;
};

/**
 * The asset-detail summary of an asset's fault history (US-004 AC3, AC4).
 *
 * Two queries, run once on the **layout** loader and read back by the tab
 * label, the Overview card and the out-of-action panel through
 * `useRouteLoaderData` — one loader, no duplication, and no per-surface
 * re-query (`design.md` §11 item 8, settled as `DECISIONS.md` #223).
 *
 * An asset with no faults returns `{ count: 0, recent: [], openRepair: null }`,
 * which every consumer renders as an empty state or as nothing at all — never
 * a zero-row table (AC4).
 *
 * ⚠️ **Call this only for a caller holding `assetRepair:read`.** It returns
 * fault text and reporter names, which `SELF_SERVICE` must not receive
 * (`DECISIONS.md` #35 grants `read` to `BASE` and nobody below it; `design.md`
 * §6.3 gives `SELF_SERVICE` the heading and first sentence only). The gate is
 * the caller's, not this function's — see the layout loader.
 *
 * @param args.assetId - Asset whose history to summarise (user-supplied, org-checked)
 * @param args.organizationId - Caller's session organization
 * @returns The all-time count, the most recent few rows, and the open repair
 * @throws {ShelfError} 400 when the asset is not in the caller's organization (AC7)
 * @throws {ShelfError} 500 if the query fails
 */
export async function getAssetRepairSummary({
  assetId,
  organizationId,
}: AssetRepairHistoryScope): Promise<AssetRepairSummary> {
  try {
    // SECURITY: same cross-org guard as the full history — see that function.
    await assertAssetsBelongToOrg({ assetIds: [assetId], organizationId });

    const where: Prisma.AssetRepairWhereInput = { assetId, organizationId };

    const [rows, count] = await Promise.all([
      db.assetRepair.findMany({
        where,
        take: FAULT_HISTORY_CARD_LIMIT,
        orderBy: REPAIR_HISTORY_ORDER_BY,
        select: REPAIR_HISTORY_SELECT,
      }),
      db.assetRepair.count({ where }),
    ]);

    const now = Date.now();
    const recent = rows.map((row) => toRepairHistoryItem(row, now));

    return {
      count,
      recent,
      // See the field doc for why `recent[0]` is sufficient.
      openRepair: recent[0]?.closedAt === null ? recent[0] : null,
    };
  } catch (cause) {
    if (isLikeShelfError(cause)) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      label,
      message:
        "Something went wrong while loading this item's fault history. Please try again or contact support.",
      additionalData: { assetId, organizationId },
    });
  }
}

/**
 * Builds the search half of the list's `where` clause.
 *
 * Mirrors the reminders convention (`getPaginatedAndFilterableReminders`):
 * comma-separated keywords are ORed, and each keyword matches the item title or
 * the fault text. It can only ever NARROW the result set — it is ANDed with the
 * org and open predicates, never spread over them.
 *
 * @param search - The raw `?s=` value
 * @returns A `where` fragment, or `{}` when there is nothing to search for
 */
function buildRepairSearchWhere(
  search: string | null | undefined
): Prisma.AssetRepairWhereInput {
  const terms = (search ?? "")
    .toLowerCase()
    .trim()
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);

  if (terms.length === 0) {
    return {};
  }

  return {
    OR: terms.map((term) => ({
      OR: [
        { faultDescription: { contains: term, mode: "insensitive" } },
        { asset: { title: { contains: term, mode: "insensitive" } } },
      ],
    })),
  };
}

/**
 * Whole days between a past instant and now, floored at zero.
 *
 * Elapsed 24-hour periods, deliberately **not** calendar days: the workspace's
 * timezone is not plumbed into this loader, and counting calendar days in the
 * server's timezone would tell a UK user "out of action for 1 day" about a
 * fault reported twenty minutes ago on the other side of midnight. `0`
 * therefore means "within the last 24 hours", which `design.md` D3 renders as
 * "Reported today".
 *
 * @param from - The earlier instant (a repair's `reportedAt`)
 * @param now - Milliseconds since the epoch, captured once per page
 * @returns Whole days elapsed, never negative
 */
function daysSince(from: Date, now: number): number {
  return Math.max(0, Math.floor((now - from.getTime()) / MS_PER_DAY));
}

/**
 * The reporter's name for a list row.
 *
 * Three sources in order: the live user, the snapshot captured at write time
 * (the FK is `ON DELETE SET NULL`, so a deleted reporter would otherwise render
 * anonymously), then `Unknown` (`design.md` §7's "Deleted user →
 * `reporterSnapshot` name, or `Unknown` if that is null too").
 *
 * @param repair - A row carrying `reportedBy` and `reporterSnapshot`
 * @returns A display name, never an empty string
 */
function resolveReporterName(repair: {
  reportedBy: {
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
  } | null;
  reporterSnapshot: Prisma.JsonValue;
}): string {
  return (
    resolveUserDisplayName(repair.reportedBy) ||
    resolveUserDisplayName(readUserSnapshot(repair.reporterSnapshot)) ||
    "Unknown"
  );
}

/**
 * The name of whoever marked a repair repaired (US-004 AC2).
 *
 * Same three-source fallback as {@link resolveReporterName} — live user, then
 * the snapshot captured at closure, then `Unknown` — but returns **`null`** for
 * an open repair rather than a placeholder: an unclosed repair has no closer,
 * which is a different fact from "we lost their name".
 *
 * @param repair - A row carrying `closedAt`, `closedBy` and `closerSnapshot`
 * @returns A display name, or `null` when the repair is not closed
 */
function resolveCloserName(repair: {
  closedAt: Date | null;
  closedBy: {
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
  } | null;
  closerSnapshot: Prisma.JsonValue;
}): string | null {
  if (!repair.closedAt) {
    return null;
  }

  return (
    resolveUserDisplayName(repair.closedBy) ||
    resolveUserDisplayName(readUserSnapshot(repair.closerSnapshot)) ||
    "Unknown"
  );
}

/**
 * Narrows a persisted `Json` user snapshot to {@link UserSnapshot}.
 *
 * The column is `Json?`, so its runtime shape is genuinely unknown — it may
 * predate a field, or be `DbNull`. Each member is checked individually rather
 * than asserted, so a malformed snapshot degrades to `Unknown` instead of
 * rendering `[object Object]`.
 *
 * @param value - The raw `reporterSnapshot` / `closerSnapshot` value
 * @returns The snapshot, or `null` when it is absent or not an object
 */
function readUserSnapshot(value: Prisma.JsonValue): UserSnapshot | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, Prisma.JsonValue | undefined> = value;
  const asString = (field: Prisma.JsonValue | undefined): string | null =>
    typeof field === "string" ? field : null;

  return {
    firstName: asString(record.firstName),
    lastName: asString(record.lastName),
    displayName: asString(record.displayName),
  };
}

/* -------------------------------------------------------------------------- *
 *  US-008 — the repair lifecycle                                              *
 * -------------------------------------------------------------------------- */

/**
 * The legal moves between OPEN stages (US-008 AC2a).
 *
 * **Backwards is deliberately allowed.** A bench fix that fails puts the item
 * back on the bench, and a system that refuses that only teaches people to work
 * around it. What is NOT allowed is leaving a terminal state: `fixed` (which is
 * `closedAt` set) and `written off` (which is `outcome` set) are absent from
 * this table entirely, and the compare-and-set below enforces that by naming
 * both in its `where`.
 *
 * ⚠️ **`fixed` is not reachable from here at all.** It is the consequence of
 * US-005's close — one action, "mark repaired" — and nothing may reach it
 * without going through that compare-and-set (#25 as amended by #38).
 *
 * ⚠️ BA specification, not Neil's (`DECISIONS.md` #68). Cheap to overturn: it
 * is this table, not a schema.
 */
const ALLOWED_STAGE_TRANSITIONS: Record<RepairStatus, RepairStatus[]> = {
  [RepairStatusEnum.REPORTED]: [
    RepairStatusEnum.DIAGNOSED,
    RepairStatusEnum.IN_REPAIR,
  ],
  [RepairStatusEnum.DIAGNOSED]: [
    RepairStatusEnum.REPORTED,
    RepairStatusEnum.IN_REPAIR,
  ],
  [RepairStatusEnum.IN_REPAIR]: [
    RepairStatusEnum.REPORTED,
    RepairStatusEnum.DIAGNOSED,
  ],
};

/**
 * Which stages may legally move TO `toStatus`.
 *
 * Inverting the table rather than checking after the fact is what lets the
 * update name the from-stage in its `where` — which is what makes the refusal
 * atomic rather than a pre-read (AC8), and settles the concurrency case for
 * free: two leads advancing the same repair means exactly one succeeds.
 *
 * @param toStatus - The stage being moved to
 * @returns Every stage from which that move is legal
 */
function stagesThatMayMoveTo(toStatus: RepairStatus): RepairStatus[] {
  return (Object.keys(ALLOWED_STAGE_TRANSITIONS) as RepairStatus[]).filter(
    (from) => ALLOWED_STAGE_TRANSITIONS[from].includes(toStatus)
  );
}

/** Human wording for a stage, for notes and refusals. */
const STAGE_LABELS: Record<RepairStatus, string> = {
  [RepairStatusEnum.REPORTED]: "reported",
  [RepairStatusEnum.DIAGNOSED]: "diagnosed",
  [RepairStatusEnum.IN_REPAIR]: "in repair",
};

/** The refusal when a transition's compare-and-set matches nothing (AC8). */
export const REPAIR_TRANSITION_REFUSED_MESSAGE =
  "That repair has already moved on. Close this and refresh to see where it is now.";

type TransitionRepairStageArgs = {
  /** User-supplied, from the URL. Proven org-owned before anything is written. */
  assetId: string;
  /** User-supplied, from the URL. Part of the compare-and-set's `where`. */
  repairId: string;
  /** From the session — NEVER the request. */
  organizationId: string;
  /** The lead moving it. `OWNER`/`ADMIN` only, enforced on the route (AC9). */
  userId: string;
  /** The stage to move to. Never `fixed` — that is US-005's close. */
  toStatus: RepairStatus;
  /** Optional bench findings recorded with the move (AC1). */
  diagnosis?: string;
};

/**
 * Moves a repair between open stages (US-008 AC2, AC6, AC8).
 *
 * **Atomic, never a pre-read.** The `where` names every stage from which this
 * move is legal, plus `closedAt: null` and `outcome: null` to keep terminal
 * states terminal. A zero row count IS the refusal — so an illegal transition,
 * a terminal repair and a concurrent move are all one code path, and nothing is
 * written in any of them (AC8: "no stage change, no note, no activity event").
 *
 * The diagnosis is stored SEPARATELY from `faultDescription`, which is never
 * overwritten (AC1, US-004 AC5) — they are different facts from different
 * people, and collapsing them loses the reporter's words.
 *
 * @param args - See {@link TransitionRepairStageArgs}
 * @returns The stage it moved from and to, for the caller's toast
 * @throws {ShelfError} 400 when the move is illegal, the repair is terminal, or
 *   another lead moved it first
 * @throws {ShelfError} 404 when the repair does not resolve in this org (AC11)
 */
export async function transitionRepairStage({
  assetId,
  repairId,
  organizationId,
  userId,
  toStatus,
  diagnosis,
}: TransitionRepairStageArgs): Promise<{
  fromStatus: RepairStatus;
  toStatus: RepairStatus;
}> {
  try {
    return await db.$transaction(async (tx) => {
      /**
       * SECURITY (cross-org IDOR): `assetId` came from the URL (AC11).
       * `.claude/rules/org-scope-user-supplied-ids.md` — the shared guard, with
       * the active `tx` so it commits atomically with the update.
       */
      await assertAssetsBelongToOrg(
        { assetIds: [assetId], organizationId },
        tx
      );

      const legalFrom = stagesThatMayMoveTo(toStatus);

      /**
       * Read the current stage BEFORE the CAS purely so the event and note can
       * name what it moved FROM. This is not a pre-read of the decision — the
       * `where` below still decides, so a concurrent move still produces
       * `count === 0` and a refusal. Reading it after the fact would be too
       * late: the row already holds the new value.
       */
      const before = await tx.assetRepair.findFirst({
        where: { id: repairId, organizationId, assetId },
        select: { id: true, status: true },
      });

      const { count } = await tx.assetRepair.updateMany({
        where: {
          id: repairId,
          organizationId,
          assetId,
          // Terminal states are terminal: `fixed` has `closedAt` set, `written
          // off` has `outcome` set. Naming both here is what refuses AC8's
          // "any transition out of a terminal stage".
          closedAt: null,
          outcome: null,
          // AC8's "a conditional update whose `where` names the stage it is
          // moving FROM". An illegal move matches nothing.
          status: { in: legalFrom },
        },
        data: {
          status: toStatus,
          // `undefined` means "leave unchanged", so an omitted diagnosis does
          // not blank one recorded earlier.
          ...(diagnosis === undefined ? {} : { diagnosis }),
        },
      });

      if (count === 0) {
        throw new ShelfError({
          cause: null,
          label,
          status: 400,
          // A business refusal — a stale tab or a lost race, not a fault.
          shouldBeCaptured: false,
          title: "Couldn't move this repair",
          message: REPAIR_TRANSITION_REFUSED_MESSAGE,
          additionalData: { assetId, repairId, organizationId, toStatus },
        });
      }

      const fromStatus = before?.status ?? RepairStatusEnum.REPORTED;

      const actor = await tx.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true, displayName: true },
      });
      const actorLink = wrapUserLinkForNote({
        id: userId,
        firstName: actor?.firstName ?? null,
        lastName: actor?.lastName ?? null,
        displayName: actor?.displayName ?? null,
      });

      /**
       * The diagnosis is user-typed free text spliced into Markdoc-rendered
       * note content, so a raw `{% … %}` would become a live tag — a stored
       * XSS. `appendUserTextToNote` strips the delimiters with the
       * repeat-until-stable helper (`.claude/rules/sanitize-note-content-markdoc.md`).
       */
      await createNotes(
        {
          content: appendUserTextToNote(
            `${actorLink} moved this repair from **${STAGE_LABELS[fromStatus]}** to **${STAGE_LABELS[toStatus]}**.`,
            diagnosis
          ),
          type: "UPDATE",
          userId,
          assetIds: [assetId],
          organizationId,
        },
        tx
      );

      /**
       * One event per LOGICAL change (AC6,
       * `.claude/rules/record-event-payload-shapes.md`) — the stage move, and
       * separately the diagnosis if one was recorded, because "how often does a
       * repair stall at diagnosed?" and "how often do we record a diagnosis?"
       * are different questions and both should stay `groupBy`-able.
       */
      await recordEvent(
        {
          organizationId,
          actorUserId: userId,
          action: "ASSET_REPAIR_STAGE_CHANGED",
          entityType: "ASSET",
          entityId: assetId,
          assetId,
          field: "status",
          fromValue: fromStatus,
          toValue: toStatus,
          meta: { repairId },
        },
        tx
      );

      if (diagnosis !== undefined) {
        await recordEvent(
          {
            organizationId,
            actorUserId: userId,
            action: "ASSET_REPAIR_DIAGNOSED",
            entityType: "ASSET",
            entityId: assetId,
            assetId,
            meta: { repairId },
          },
          tx
        );
      }

      return { fromStatus, toStatus };
    });
  } catch (cause) {
    if (isLikeShelfError(cause)) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      label,
      message:
        "Something went wrong while moving this repair. Please try again or contact support.",
      additionalData: { assetId, repairId, organizationId, userId },
    });
  }
}

/** Optional note recorded when writing an item off. */
export const WRITE_OFF_REASON_MAX_LENGTH = 1000;

/** The refusal when a write-off's compare-and-set matches nothing. */
export const REPAIR_WRITE_OFF_REFUSED_MESSAGE =
  "This repair has already ended — it was either marked repaired or already written off. Close this and refresh.";

type WriteOffRepairArgs = {
  /** User-supplied, from the URL. Proven org-owned first. */
  assetId: string;
  /** User-supplied, from the URL. Part of the compare-and-set's `where`. */
  repairId: string;
  /** From the session — NEVER the request. */
  organizationId: string;
  /** The lead writing it off. `OWNER`/`ADMIN` only (AC9). */
  userId: string;
  /** Optional "why" recorded with the outcome. Sanitised before it reaches a note. */
  reason?: string;
};

/** What the caller needs after a successful write-off. */
type WriteOffRepairResult = {
  repairId: string;
  assetId: string;
  assetTitle: string;
  /** The fault as reported — the write-off warning email quotes it. */
  faultDescription: string;
};

/**
 * Writes an item off as beyond repair (US-008 AC4, AC5, AC12).
 *
 * ⚠️ **`closedAt` is deliberately NOT stamped** (`DECISIONS.md` #37). That is
 * the whole mechanism: bookability is `closedAt IS NULL` and only that (#31), so
 * leaving it NULL is what keeps scrapped gear permanently out of the pool
 * through the ordinary booking guard, with no second flag to keep in step and
 * no change to the guard itself. It reads as a bug and is the opposite.
 *
 * The consequence is that US-005's close would otherwise match this row — which
 * is why its compare-and-set gained `outcome: null` in this same story (#38).
 * The two halves must ship together or scrapped gear returns to the pool.
 *
 * The only route back is US-012's reinstate, which stamps `closedAt` while
 * leaving `outcome` set for ever (#46, #47).
 *
 * @param args - See {@link WriteOffRepairArgs}
 * @returns Identifiers plus what the post-commit warning email needs
 * @throws {ShelfError} 400 when the repair has already ended
 * @throws {ShelfError} 404 when it does not resolve in this organisation (AC11)
 */
export async function writeOffRepair({
  assetId,
  repairId,
  organizationId,
  userId,
  reason,
}: WriteOffRepairArgs): Promise<WriteOffRepairResult> {
  try {
    const result = await db.$transaction(async (tx) => {
      const asset = await tx.asset.findFirst({
        where: { id: assetId, organizationId },
        select: { id: true, title: true },
      });

      if (!asset) {
        throw new ShelfError({
          cause: null,
          label,
          status: 404,
          shouldBeCaptured: false,
          title: "Fault report not found",
          message: REPAIR_NOT_FOUND_MESSAGE,
          additionalData: { assetId, repairId, organizationId },
        });
      }

      // SECURITY (cross-org IDOR), AC11 — the shared guard, inside the tx.
      await assertAssetsBelongToOrg(
        { assetIds: [assetId], organizationId },
        tx
      );

      const actor = await tx.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true, displayName: true },
      });

      const actorSnapshot: UserSnapshot | null = actor
        ? {
            firstName: actor.firstName,
            lastName: actor.lastName,
            displayName: actor.displayName,
          }
        : null;

      /**
       * The fault text, read inside the tx because the AC12 warning email
       * quotes it and re-reading after the commit would be a second round trip
       * on an interactive path.
       */
      const before = await tx.assetRepair.findFirst({
        where: { id: repairId, organizationId, assetId },
        select: { faultDescription: true },
      });

      const { count } = await tx.assetRepair.updateMany({
        where: {
          id: repairId,
          organizationId,
          assetId,
          // Both terminal states excluded: already repaired (`closedAt` set) or
          // already written off (`outcome` set). A zero count IS the refusal —
          // atomic, so two leads writing off at once means one succeeds.
          closedAt: null,
          outcome: null,
        },
        data: {
          outcome: "WRITTEN_OFF",
          outcomeAt: new Date(),
          outcomeById: userId,
          // `outcomeById` is `ON DELETE SET NULL`, so the name is captured now
          // or the history renders anonymously later (#108).
          outcomeActorSnapshot: actorSnapshot ?? Prisma.DbNull,
          // ⚠️ `closedAt` is NOT set. See the function doc — this is the
          // mechanism, not an omission.
        },
      });

      if (count === 0) {
        throw new ShelfError({
          cause: null,
          label,
          status: 400,
          shouldBeCaptured: false,
          title: "This repair has already ended",
          message: REPAIR_WRITE_OFF_REFUSED_MESSAGE,
          additionalData: { assetId, repairId, organizationId },
        });
      }

      const actorLink = wrapUserLinkForNote({
        id: userId,
        firstName: actor?.firstName ?? null,
        lastName: actor?.lastName ?? null,
        displayName: actor?.displayName ?? null,
      });

      // `reason` is user-typed and lands in Markdoc-rendered note content —
      // stripped by `appendUserTextToNote`, never hand-rolled.
      await createNotes(
        {
          content: appendUserTextToNote(
            `${actorLink} wrote this item off as beyond repair. It can't be booked or checked out.`,
            reason
          ),
          type: "UPDATE",
          userId,
          assetIds: [assetId],
          organizationId,
        },
        tx
      );

      await recordEvent(
        {
          organizationId,
          actorUserId: userId,
          action: "ASSET_REPAIR_WRITTEN_OFF",
          entityType: "ASSET",
          entityId: assetId,
          assetId,
          meta: { repairId },
        },
        tx
      );

      return {
        repairId,
        assetId,
        assetTitle: asset.title,
        faultDescription: before?.faultDescription ?? "",
      };
    });

    /**
     * AC12 — warn the future bookings a SECOND time, post-commit
     * (`DECISIONS.md` #71). Neil asked for this knowing they were warned once
     * already at report time: writing off is the moment it becomes certain the
     * gear is not coming back, and those bookings are still standing.
     *
     * **This is a second TRIGGER on US-011's existing fan-out, not a second
     * fan-out.** Recipient resolution, the `ASSET_FAULT` narrowing, the
     * de-duplication and the post-commit resilience all come from there; only
     * the copy differs. Post-commit for the same reason as US-011: a mail
     * failure must not roll back a write-off, and a rolled-back write-off must
     * not leave an email sent.
     */
    await warnBookingsAssetWrittenOff({
      assetId,
      assetTitle: result.assetTitle,
      faultDescription: result.faultDescription,
      organizationId,
      reporterUserId: userId,
    });

    return result;
  } catch (cause) {
    if (isLikeShelfError(cause)) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      label,
      message:
        "Something went wrong while writing this item off. Please try again or contact support.",
      additionalData: { assetId, repairId, organizationId, userId },
    });
  }
}
