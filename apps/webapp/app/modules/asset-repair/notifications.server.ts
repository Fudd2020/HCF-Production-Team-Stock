/**
 * Asset Repair — the post-commit notification fan-out (US-009 + US-011).
 *
 * ONE hook, called once after a fault report commits, doing two independent
 * fan-outs to two different audiences (`DECISIONS.md` #58 sequenced these
 * together for exactly this reason — same trigger, same resilience shape,
 * different recipients and templates):
 *
 * | Story  | Audience                                          | Template                       |
 * | ------ | ------------------------------------------------- | ------------------------------ |
 * | US-009 | the org's `OWNER` + `ADMIN`, minus the reporter    | `asset-fault-reported`         |
 * | US-011 | each future booking's custodian + its recipients  | `booking-asset-fault-warning`  |
 *
 * ## Two rules this module exists to hold
 *
 * **1. It is called AFTER the transaction commits, never inside it.** A mail
 * failure must not roll back a repair that was correctly recorded (US-009 AC3 /
 * US-011 AC5), and a rolled-back transaction must not leave an email already
 * sent (US-009 AC4 / US-011 AC6). Those two requirements point in opposite
 * directions and only post-commit satisfies both.
 *
 * **2. Nothing here ever throws.** {@link notifyFaultReported} is `void` and
 * swallows everything. The caller has already committed; there is nothing left
 * for it to do with an error, and surfacing one would tell the reporter their
 * report failed when it did not. Resilience is layered exactly as
 * `low-stock.server.ts` does it — the whole block in a `try/catch`, AND each
 * per-recipient send in its own, so one bad address cannot abort the loop.
 *
 * **Burst is accepted, deliberately.** Pack-down after a service can produce
 * six reports in ten minutes and therefore six emails per lead. Neil chose
 * immediate over a digest knowing that (#13). Do not add batching, throttling
 * or a digest window here.
 *
 * @see {@link file://./service.server.ts} — the caller, `reportAssetFault`
 * @see {@link file://./../consumption-log/low-stock.server.ts} — the resilience precedent
 */

import { BookingStatus } from "@prisma/client";

import { db } from "~/database/db.server";
import {
  assetFaultReportedHtml,
  assetFaultReportedText,
} from "~/emails/asset-fault-reported";
import {
  bookingAssetFaultWarningHtml,
  bookingAssetFaultWarningText,
} from "~/emails/booking-asset-fault-warning";
import { sendEmail } from "~/emails/mail.server";
import { BOOKING_INCLUDE_FOR_EMAIL } from "~/modules/booking/constants";
import { getBookingNotificationRecipients } from "~/modules/booking/notification-recipients.server";
import { getOrganizationAdminsForNotification } from "~/modules/organization/service.server";
import { formatDate, resolveFormatPrefs } from "~/utils/date-format";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

const label = "Notification" as const;

/**
 * Which booking-warning message to send.
 *
 * `"reported"` — a fault was reported; the item MAY come back (US-011).
 * `"written-off"` — it is not coming back; replace it (US-008 AC12).
 */
export type BookingWarningVariant = "reported" | "written-off";

/**
 * Booking statuses whose people are warned (US-011 AC2).
 *
 * ⚠️ **`DRAFT` is in this set and that is not an oversight.** The active-booking
 * set used elsewhere in the app excludes it, and an earlier draft of the story
 * said to reuse that set — **Neil overruled it** (`DECISIONS.md` #65): someone
 * still drafting Sunday's booking learns the cable is broken while they can
 * still swap it, which is the moment the warning is worth most. Read #57
 * without #65 and you build a filter that silently warns nobody on every draft.
 *
 * `CANCELLED` and `COMPLETE` are absent because a warning about gear you are no
 * longer taking is noise.
 */
const WARNABLE_BOOKING_STATUSES = [
  BookingStatus.DRAFT,
  BookingStatus.RESERVED,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
] as const;

/** What the fan-out needs to know about the fault that was just reported. */
type NotifyFaultReportedArgs = {
  /** The asset reported faulty. */
  assetId: string;
  /** Its title, already loaded by the caller — saves a re-read. */
  assetTitle: string;
  /** The fault as typed. User-controlled; the templates escape it. */
  faultDescription: string;
  /** From the session. Scopes every query and every recipient set. */
  organizationId: string;
  /**
   * Who reported it. Excluded from BOTH fan-outs — US-009 AC8 and US-011 AC11
   * (`DECISIONS.md` #68 and #66). They typed the description and already have
   * the confirmation; an email telling you what you just did reads as a bug.
   */
  reporterUserId: string;
  /**
   * The reporter's display name, for the body of the leads' email.
   *
   * Optional because US-008's write-off trigger reuses this shape but sends
   * only the booking warning, which never names an actor.
   */
  reporterName?: string;
};

/**
 * Notifies everyone who needs to know that an asset was reported faulty.
 *
 * **Never throws, never rejects.** See the module doc.
 *
 * The two fan-outs are independent: `Promise.all` over two functions that each
 * swallow their own errors, so a failure resolving bookings cannot stop the
 * leads being told, and vice versa.
 *
 * @param args - See {@link NotifyFaultReportedArgs}
 */
export async function notifyFaultReported(
  args: NotifyFaultReportedArgs
): Promise<void> {
  await Promise.all([
    notifyOrganizationLeads(args),
    warnAffectedBookings(args),
  ]);
}

/**
 * US-008 AC12 — an item on a future booking has been WRITTEN OFF.
 *
 * A second trigger on {@link warnAffectedBookings}, not a second fan-out
 * (`DECISIONS.md` #71 is explicit about this). The audience, the
 * de-duplication, the `DRAFT`-inclusive status set, the reporter exclusion and
 * the resilience are all US-011's; only the message changes.
 *
 * ⚠️ **Only the terminal write-off fires this.** `reported → diagnosed → in
 * repair` is internal progress, and emailing on each transition would train
 * people to ignore the emails — which costs you the two that matter.
 *
 * Never throws. See the module doc.
 *
 * @param args - The asset, the fault, and who wrote it off (excluded)
 */
export async function warnBookingsAssetWrittenOff(
  args: NotifyFaultReportedArgs
): Promise<void> {
  await warnAffectedBookings(args, "written-off");
}

/**
 * US-009 — email every `OWNER` and `ADMIN` except the reporter.
 *
 * @param args - See {@link NotifyFaultReportedArgs}
 */
async function notifyOrganizationLeads({
  assetId,
  assetTitle,
  faultDescription,
  organizationId,
  reporterUserId,
  reporterName,
}: NotifyFaultReportedArgs): Promise<void> {
  try {
    const [organization, leads] = await Promise.all([
      db.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
      // Already org-scoped, and returns OWNER + ADMIN (AC2).
      getOrganizationAdminsForNotification({ organizationId }),
    ]);

    const organizationName = organization?.name ?? "your workspace";

    /**
     * AC8 (exclude the reporter) and AC6 (skip a recipient with no address).
     *
     * AC7: this can legitimately resolve to NOBODY — a one-lead workspace where
     * that lead reports their own fault. That is explicitly not an error: the
     * loop simply does not run, nothing is logged, and the repair is untouched.
     */
    const recipients = leads.filter(
      (lead) => lead.id !== reporterUserId && lead.email
    );

    const subject = `Fault reported: ${assetTitle}`;

    for (const recipient of recipients) {
      try {
        /**
         * Rendered per recipient because the greeting is personalised (AC5).
         * The audience is a handful of leads, so this is cheap; if it ever
         * became large, the fix is a shared render plus a per-recipient
         * greeting, not dropping the personalisation.
         */
        const props = {
          recipientFirstName: recipient.firstName,
          assetTitle,
          faultDescription,
          reporterName: reporterName ?? "Someone",
          assetId,
          organizationName,
        };

        sendEmail({
          to: recipient.email,
          subject,
          html: await assetFaultReportedHtml(props),
          text: assetFaultReportedText(props),
        });
      } catch (cause) {
        /** One bad recipient must not abort the loop (AC3). */
        Logger.error(
          new ShelfError({
            cause,
            message: "Failed to email a lead about a reported fault",
            additionalData: {
              assetId,
              organizationId,
              recipientId: recipient.id,
            },
            label,
          })
        );
      }
    }
  } catch (cause) {
    /** The report is already committed. Log and move on (AC3). */
    Logger.error(
      new ShelfError({
        cause,
        message:
          "Failed to notify the organisation's leads of a reported fault",
        additionalData: { assetId, organizationId },
        label,
      })
    );
  }
}

/**
 * US-011 — warn the people attached to each future booking carrying the asset.
 *
 * **One query, not one per booking.** The bookings are fetched once with the
 * relations the recipient resolver needs; `getBookingNotificationRecipients`
 * with `ASSET_FAULT` then runs purely in memory over those relations, because
 * that event short-circuits the settings query and the admin lookup (#55). The
 * fault-report path is interactive — a user is waiting on a form submit — so it
 * must not become a per-booking or per-recipient query.
 *
 * @param args - See {@link NotifyFaultReportedArgs}
 */
async function warnAffectedBookings(
  {
    assetId,
    assetTitle,
    faultDescription,
    organizationId,
    reporterUserId,
  }: NotifyFaultReportedArgs,
  /**
   * Which message to send. US-008 AC12 adds a SECOND trigger on this same
   * fan-out — recipients, de-duplication and resilience are identical, and only
   * the copy differs, so a variant is correct where a second function would be
   * duplication that drifts.
   *
   * `"reported"` means *this may come back*; `"written-off"` means *it is not
   * coming back — replace it*. The story is explicit that they must be
   * materially different, because a warning that reads the same as the last one
   * teaches people to ignore both.
   */
  variant: BookingWarningVariant = "reported"
): Promise<void> {
  try {
    const bookings = await db.booking.findMany({
      where: {
        organizationId,
        status: { in: [...WARNABLE_BOOKING_STATUSES] },
        // AC2 — only bookings that have not started.
        from: { gt: new Date() },
        /**
         * ⚠️ Query BOOKINGS, matching on the pivot — do NOT query
         * `BookingAsset` rows and fan out per row.
         *
         * `assetId` is populated on EVERY `BookingAsset` row, kit-driven or
         * standalone, so this one predicate finds both with no union and no
         * `AssetKit` join (`DECISIONS.md` #53). The failure mode is ADDING a
         * filter here — `assetKitId: null`, or "properly" joining through the
         * kit — which would silently miss a kit member, the exact case US-006
         * exists for.
         *
         * It also solves the duplicate-send problem for free: the two partial
         * uniques on the pivot allow one standalone row AND N kit-driven rows
         * for the same (booking, asset), so a per-row fan-out would email the
         * custodian of a kit-heavy booking the same warning three times. One
         * booking, one row here, one email.
         */
        bookingAssets: { some: { assetId } },
      },
      include: BOOKING_INCLUDE_FOR_EMAIL,
    });

    /**
     * AC7 — the common case: the asset is on no future booking. One query, no
     * emails, nothing logged.
     */
    if (bookings.length === 0) {
      return;
    }

    for (const booking of bookings) {
      /**
       * In-memory for `ASSET_FAULT`: no settings query, no admin lookup. It
       * resolves exactly the custodian + the per-booking recipients (#18, #54),
       * de-duplicated by resolved identity so someone who is both receives ONE
       * email (AC3), and excludes the reporter unconditionally (AC11, #66) —
       * which is what the `ASSET_FAULT` branch in that function is for.
       */
      const recipients = await getBookingNotificationRecipients({
        booking,
        eventType: "ASSET_FAULT",
        organizationId,
        editorUserId: reporterUserId,
      });

      // AC11's tail: if the reporter was the only recipient, send nothing —
      // and that is not an error.
      if (recipients.length === 0) {
        continue;
      }

      const subject =
        variant === "written-off"
          ? `Item written off on your booking: ${booking.name}`
          : `Item out of action on your booking: ${booking.name}`;

      for (const recipient of recipients) {
        try {
          /**
           * Resolved from the already-loaded recipient row rather than fetched
           * — the format-preference columns ride along on the include for
           * exactly this reason (no N+1).
           */
          const prefs = resolveFormatPrefs(recipient, null);
          const bookingPeriod =
            booking.from && booking.to
              ? `${formatDate(booking.from, prefs, {
                  includeTime: true,
                })} – ${formatDate(booking.to, prefs, { includeTime: true })}`
              : "dates not set";

          const props = {
            recipientFirstName: recipient.firstName,
            assetTitle,
            faultDescription,
            bookingName: booking.name,
            bookingId: booking.id,
            bookingPeriod,
            variant,
          };

          sendEmail({
            to: recipient.email,
            subject,
            html: await bookingAssetFaultWarningHtml(props),
            text: bookingAssetFaultWarningText(props),
          });
        } catch (cause) {
          /** One bad recipient must not abort the loop (AC5, AC10). */
          Logger.error(
            new ShelfError({
              cause,
              message:
                "Failed to warn a booking recipient about a faulty asset",
              additionalData: {
                assetId,
                organizationId,
                bookingId: booking.id,
                recipientEmail: recipient.email,
              },
              label,
            })
          );
        }
      }
    }
  } catch (cause) {
    /** The report is already committed. Log and move on (AC5). */
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to warn affected bookings about a reported fault",
        additionalData: { assetId, organizationId },
        label,
      })
    );
  }
}
