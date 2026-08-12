/**
 * Asset Repair Service — the WRITE path (US-001 report, US-005 close).
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
           * per #31, the whole bookability rule — so this one condition is what
           * makes closing twice impossible (AC6).
           *
           * ⚠️ US-008 ADDS ONE MORE CONDITION HERE: `outcome: null`
           * (`DECISIONS.md` #38, US-005 AC11, `progress.md` §3.7). A written-off
           * repair deliberately keeps `closedAt = NULL` for ever (#37), so once
           * the `outcome` column exists this CAS WOULD MATCH IT and
           * return scrapped gear to the bookable pool — the exact outcome
           * #36 forbids. The column does not exist yet, so it is not written
           * here: inventing it would not compile and would not be true. Whoever
           * builds US-008 adds it at this line, and adds the written-off branch
           * in `buildCloseRefusal` below.
           */
          closedAt: null,
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
       * ⚠️ MISSING: the structured `ActivityEvent` row required by US-005 AC5 —
       * the same gap US-001 left, for the same reason.
       *
       * `recordEvent({ organizationId, actorUserId: userId,
       * action: "ASSET_REPAIR_CLOSED", entityType: "ASSET", entityId: assetId,
       * assetId, meta: { repairId } }, tx)` belongs HERE, inside this
       * transaction (`.claude/rules/use-record-event.md`), and its own action
       * rather than a shared "repair updated" umbrella so "how many did we
       * return to service" stays a `groupBy`
       * (`.claude/rules/record-event-payload-shapes.md`, `progress.md` §3.6).
       *
       * It cannot be written yet: `ActivityAction` has no `ASSET_REPAIR_*`
       * values, and the enum lives in `packages/database/prisma/schema.prisma`,
       * which the backend developer does not own. Casting a string past the
       * enum would compile and then fail at the database. Tracked in the
       * handoff — `shelf-database-specialist` adds `ASSET_REPAIR_REPORTED` /
       * `ASSET_REPAIR_CLOSED`, then this becomes a five-line change here and in
       * `reportAssetFault`.
       */

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
      select: { id: true; assetId: true; closedAt: true };
    }) => Promise<{
      id: string;
      assetId: string;
      closedAt: Date | null;
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
    select: { id: true, assetId: true, closedAt: true },
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
   * The row exists, belongs to this asset and this organisation, and is still
   * open — yet the compare-and-set matched nothing.
   *
   * ⚠️ THIS IS US-008's BRANCH (`DECISIONS.md` #38, US-005 AC11). Once the
   * `outcome` column exists and the CAS above gains `outcome: null`, a
   * written-off repair lands exactly here, and this becomes a 400 with
   * `shouldBeCaptured: false` and `design.md` §8's wording: "This item was
   * written off, so it can't be returned to service." — deliberately different
   * words from the already-closed refusal, because they are different states.
   *
   * Until then it is unreachable, so it stays a captured 500: if it ever fires
   * today, the CAS and this discrimination have drifted apart and someone needs
   * to know. AC11 CANNOT be satisfied before US-008 ships — the state it
   * refuses does not exist yet.
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
