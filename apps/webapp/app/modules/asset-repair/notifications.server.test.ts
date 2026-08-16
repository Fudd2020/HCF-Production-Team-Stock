/**
 * Unit tests for the post-commit notification fan-out (US-009 + US-011).
 *
 * These cover the acceptance criteria that live in the fan-out rather than in
 * a template: who is emailed and who deliberately is not, that the two audiences
 * are resolved independently, that a broken transport never escapes, and — the
 * one most likely to be built wrong — that the booking lookup queries BOOKINGS
 * rather than booked rows.
 *
 * ## Mocking policy
 *
 * Prisma and the mail transport are stubbed because they are the genuine IO
 * boundaries. `getOrganizationAdminsForNotification` and
 * `getBookingNotificationRecipients` deliberately run FOR REAL against the
 * stubbed Prisma, because the recipient rules — the `ASSET_FAULT` narrowing and
 * its unconditional actor exclusion — are exactly what is under test. Stubbing
 * them would mock away the behaviour these stories are about.
 *
 * @see {@link file://./notifications.server.ts}
 */

import { BookingStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";

import {
  notifyFaultReported,
  warnBookingsAssetReinstated,
  warnBookingsAssetWrittenOff,
} from "./notifications.server";

// why: Prisma is the IO boundary. Both fan-outs read through it.
vi.mock("~/database/db.server", () => ({
  db: {
    organization: { findUnique: vi.fn() },
    userOrganization: { findMany: vi.fn() },
    booking: { findMany: vi.fn() },
    // `getBookingNotificationSettingsForOrg` must NEVER be reached for
    // ASSET_FAULT; leaving this unstubbed would throw if it were.
  },
}));

// why: the mail transport. Asserting on it is how we observe who was emailed.
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));

type MockFn = ReturnType<typeof vi.fn>;

const orgFindUnique = db.organization.findUnique as unknown as MockFn;
const userOrgFindMany = db.userOrganization.findMany as unknown as MockFn;
const bookingFindMany = db.booking.findMany as unknown as MockFn;
const sendEmailMock = sendEmail as unknown as MockFn;

const ORG_ID = "org-1";
const ASSET_ID = "asset-1";
const REPORTER_ID = "user-reporter";

/** A user row shaped as `getOrganizationAdminsForNotification` returns it. */
function lead(id: string, email: string | null, firstName = "Lead") {
  return {
    user: {
      id,
      email,
      firstName,
      lastName: "Person",
      dateFormat: null,
      timeFormat: null,
      weekStart: null,
      timeZone: null,
    },
  };
}

/** A booking row shaped as `BOOKING_INCLUDE_FOR_EMAIL` returns it. */
function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    name: "Sunday service",
    status: BookingStatus.RESERVED,
    organizationId: ORG_ID,
    from: new Date("2026-09-01T09:00:00.000Z"),
    to: new Date("2026-09-01T13:00:00.000Z"),
    custodianUser: {
      id: "user-custodian",
      email: "custodian@example.test",
      firstName: "Cass",
      lastName: "Todd",
      dateFormat: null,
      timeFormat: null,
      weekStart: null,
      timeZone: null,
    },
    custodianTeamMember: null,
    creator: {
      id: "user-creator",
      email: "creator@example.test",
      firstName: "Cree",
      lastName: "Ator",
      dateFormat: null,
      timeFormat: null,
      weekStart: null,
      timeZone: null,
    },
    notificationRecipients: [],
    organization: { customEmailFooter: null },
    ...overrides,
  };
}

/** Every address `sendEmail` was called with. */
function emailedAddresses(): string[] {
  return sendEmailMock.mock.calls.map((call) => call[0].to);
}

const ARGS = {
  assetId: ASSET_ID,
  assetTitle: "Ch 3 handheld radio mic",
  faultDescription: "Crackles when the cable is moved",
  organizationId: ORG_ID,
  reporterUserId: REPORTER_ID,
  reporterName: "Sam Whitfield",
};

beforeEach(() => {
  vi.clearAllMocks();
  orgFindUnique.mockResolvedValue({ name: "HCF Production" });
  userOrgFindMany.mockResolvedValue([]);
  bookingFindMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("notifyFaultReported — US-009, the leads", () => {
  it("emails every lead immediately", async () => {
    userOrgFindMany.mockResolvedValue([
      lead("user-owner", "owner@example.test", "Olive"),
      lead("user-admin", "admin@example.test", "Adam"),
    ]);

    await notifyFaultReported(ARGS);

    // AC1 — no digest window, no delay: one send per lead, now.
    expect(emailedAddresses().sort()).toEqual([
      "admin@example.test",
      "owner@example.test",
    ]);
  });

  it("does NOT email the reporter their own fault report", async () => {
    /**
     * AC8 (`DECISIONS.md` #68). An email telling you what you just typed reads
     * as a bug — and it matches the codebase precedent, where the actor is
     * excluded from every immediate notification.
     */
    userOrgFindMany.mockResolvedValue([
      lead(REPORTER_ID, "reporter@example.test", "Sam"),
      lead("user-admin", "admin@example.test", "Adam"),
    ]);

    await notifyFaultReported(ARGS);

    expect(emailedAddresses()).toEqual(["admin@example.test"]);
  });

  it("sends nothing, and raises nothing, when the reporter is the only lead", async () => {
    /**
     * AC7 + the trade AC8 explicitly accepts: in a one-lead workspace an ADMIN
     * reporting their own fault produces NO email at all. That is not an error
     * and must not be logged as one.
     */
    userOrgFindMany.mockResolvedValue([
      lead(REPORTER_ID, "reporter@example.test", "Sam"),
    ]);

    await expect(notifyFaultReported(ARGS)).resolves.toBeUndefined();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("skips a lead with no email address without dropping the others", async () => {
    // AC6 — one incomplete record must not cost everyone else their email.
    userOrgFindMany.mockResolvedValue([
      lead("user-no-email", null, "Noel"),
      lead("user-admin", "admin@example.test", "Adam"),
    ]);

    await notifyFaultReported(ARGS);

    expect(emailedAddresses()).toEqual(["admin@example.test"]);
  });

  it("carries the fault, the asset and the reporter into the email", async () => {
    userOrgFindMany.mockResolvedValue([
      lead("user-admin", "admin@example.test", "Adam"),
    ]);

    await notifyFaultReported(ARGS);

    const sent = sendEmailMock.mock.calls[0][0];

    // AC1's content requirements, checked on the plain-text part so the
    // assertion does not depend on rendered markup.
    expect(sent.subject).toContain("Ch 3 handheld radio mic");
    expect(sent.text).toContain("Crackles when the cable is moved");
    expect(sent.text).toContain("Sam Whitfield");
    expect(sent.text).toContain(`/assets/${ASSET_ID}/overview`);
    expect(sent.html).toBeTruthy();
  });

  it("keeps going when the transport throws for one recipient", async () => {
    /**
     * AC3. The repair is already committed by the time this runs, so a mail
     * failure must be logged and swallowed — never surfaced to the reporter as
     * a failed action, and never allowed to abort the remaining sends.
     */
    userOrgFindMany.mockResolvedValue([
      lead("user-a", "a@example.test", "Ann"),
      lead("user-b", "b@example.test", "Ben"),
    ]);
    sendEmailMock.mockImplementationOnce(() => {
      throw new Error("SMTP unavailable");
    });

    await expect(notifyFaultReported(ARGS)).resolves.toBeUndefined();
    // Both were attempted; the first threw and the second still went.
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });

  it("never rejects when the whole recipient lookup fails", async () => {
    // AC3's outer layer — the report must stand even if nothing about the
    // notification works.
    userOrgFindMany.mockRejectedValue(new Error("database down"));

    await expect(notifyFaultReported(ARGS)).resolves.toBeUndefined();
  });
});

describe("notifyFaultReported — US-011, the booking's people", () => {
  it("warns the custodian of a future booking", async () => {
    bookingFindMany.mockResolvedValue([booking()]);

    await notifyFaultReported(ARGS);

    expect(emailedAddresses()).toEqual(["custodian@example.test"]);
  });

  it("queries BOOKINGS matching the pivot, so kit-driven rows are included", async () => {
    /**
     * The single most consequential assertion in this file
     * (`DECISIONS.md` #53). `assetId` is populated on every `BookingAsset` row,
     * kit-driven or standalone, so `bookingAssets: { some: { assetId } }` finds
     * both. Adding `assetKitId: null`, or "properly" joining through the kit,
     * would silently miss the kit member — the exact case US-006 exists for.
     *
     * Querying bookings (not rows) is also what makes one booking produce one
     * email when a faulty asset matches a standalone row AND several kit rows.
     */
    await notifyFaultReported(ARGS);

    const where = bookingFindMany.mock.calls[0][0].where;

    expect(where.bookingAssets).toEqual({ some: { assetId: ASSET_ID } });
    expect(where.bookingAssets.some).not.toHaveProperty("assetKitId");
    expect(where.organizationId).toBe(ORG_ID);
  });

  it("includes DRAFT bookings and excludes finished ones", async () => {
    /**
     * AC2, and the thing the story flags as most likely to be built wrong.
     * The app's ACTIVE set excludes DRAFT; **Neil overruled that** (#65),
     * because someone still drafting Sunday's booking is exactly who can still
     * swap the cable.
     */
    await notifyFaultReported(ARGS);

    const where = bookingFindMany.mock.calls[0][0].where;

    expect(where.status.in).toContain(BookingStatus.DRAFT);
    expect(where.status.in).toContain(BookingStatus.RESERVED);
    expect(where.status.in).not.toContain(BookingStatus.COMPLETE);
    expect(where.status.in).not.toContain(BookingStatus.CANCELLED);
    // AC2 — only bookings that have not started.
    expect(where.from).toHaveProperty("gt");
  });

  it("does NOT warn the reporter, even when they are the custodian", async () => {
    /**
     * AC11 (`DECISIONS.md` #66), and the implementation trap it names: the
     * shared resolver's actor exclusion deliberately EXEMPTS the custodian
     * reason (#56), so reusing it without the `ASSET_FAULT` branch would email
     * them. Neil settled this as exclude, having been shown the counter-case.
     */
    bookingFindMany.mockResolvedValue([
      booking({
        custodianUser: {
          id: REPORTER_ID,
          email: "reporter@example.test",
          firstName: "Sam",
          lastName: "Whitfield",
          dateFormat: null,
          timeFormat: null,
          weekStart: null,
          timeZone: null,
        },
      }),
    ]);

    await notifyFaultReported(ARGS);

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("does not email the booking's creator or the org's admins", async () => {
    /**
     * #18 named exactly two groups, and #54/#55 kept the other three out. The
     * leads are already emailed by US-009 for this same fault from a different
     * template — including them here would double-send.
     */
    userOrgFindMany.mockResolvedValue([
      lead("user-admin", "admin@example.test", "Adam"),
    ]);
    bookingFindMany.mockResolvedValue([booking()]);

    await notifyFaultReported(ARGS);

    // The admin appears exactly once — from US-009, not a second time here.
    expect(
      emailedAddresses().filter((to) => to === "admin@example.test")
    ).toHaveLength(1);
    expect(emailedAddresses()).not.toContain("creator@example.test");
  });

  it("sends one email per person who is both custodian and recipient", async () => {
    // AC3 — de-duplicated by resolved identity, not by role.
    const sharedUser = {
      id: "user-custodian",
      email: "custodian@example.test",
      firstName: "Cass",
      lastName: "Todd",
      dateFormat: null,
      timeFormat: null,
      weekStart: null,
      timeZone: null,
    };

    bookingFindMany.mockResolvedValue([
      booking({
        notificationRecipients: [
          { id: "tm-1", name: "Cass", user: sharedUser },
        ],
      }),
    ]);

    await notifyFaultReported(ARGS);

    expect(emailedAddresses()).toEqual(["custodian@example.test"]);
  });

  it("warns each booking about its own booking when an asset is on several", async () => {
    // AC4 — nobody learns about a booking they are not attached to.
    bookingFindMany.mockResolvedValue([
      booking({ id: "booking-1", name: "Sunday service" }),
      booking({
        id: "booking-2",
        name: "Midweek rehearsal",
        custodianUser: {
          id: "user-other",
          email: "other@example.test",
          firstName: "Otto",
          lastName: "Ther",
          dateFormat: null,
          timeFormat: null,
          weekStart: null,
          timeZone: null,
        },
      }),
    ]);

    await notifyFaultReported(ARGS);

    const byRecipient = Object.fromEntries(
      sendEmailMock.mock.calls.map((call) => [call[0].to, call[0].text])
    );

    expect(byRecipient["custodian@example.test"]).toContain("Sunday service");
    expect(byRecipient["custodian@example.test"]).not.toContain(
      "Midweek rehearsal"
    );
    expect(byRecipient["other@example.test"]).toContain("Midweek rehearsal");
  });

  it("costs one query and sends nothing when the asset is on no future booking", async () => {
    // AC7 — the common case. It must be cheap and silent.
    bookingFindMany.mockResolvedValue([]);

    await notifyFaultReported(ARGS);

    expect(bookingFindMany).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("never rejects when the booking lookup fails", async () => {
    // AC5's outer layer.
    bookingFindMany.mockRejectedValue(new Error("database down"));

    await expect(notifyFaultReported(ARGS)).resolves.toBeUndefined();
  });

  it("still notifies the leads when the booking fan-out fails, and vice versa", async () => {
    /**
     * The two fan-outs are independent by construction. A failure resolving
     * bookings must not cost the leads their email — they are the people who
     * order the part.
     */
    userOrgFindMany.mockResolvedValue([
      lead("user-admin", "admin@example.test", "Adam"),
    ]);
    bookingFindMany.mockRejectedValue(new Error("database down"));

    await notifyFaultReported(ARGS);

    expect(emailedAddresses()).toEqual(["admin@example.test"]);
  });
});

/**
 * US-012 (`DECISIONS.md` #252) — the third trigger on this same fan-out.
 *
 * The audience, the de-duplication and the resilience are US-011's and are
 * covered above. What is asserted here is the ONE thing that differs and the
 * one thing that must not: the copy is materially different, and the fan-out
 * is not duplicated.
 */
describe("warnBookingsAssetReinstated — US-012, standing them down", () => {
  it("uses the SAME single query as the other two triggers", async () => {
    bookingFindMany.mockResolvedValue([booking()]);

    await warnBookingsAssetReinstated(ARGS);

    /**
     * A third TRIGGER, never a third fan-out. If this ever became its own
     * booking lookup, the kit-slice handling (#53), the DRAFT inclusion (#65)
     * and the actor exclusion (#66) would all have to be maintained twice —
     * and the second copy is the one that drifts.
     */
    expect(bookingFindMany).toHaveBeenCalledTimes(1);
    const where = bookingFindMany.mock.calls[0][0].where;
    expect(where.bookingAssets).toEqual({ some: { assetId: ASSET_ID } });
    expect(where.status.in).toContain(BookingStatus.DRAFT);
  });

  it("says the item is BACK — never a third warning that it is broken", async () => {
    bookingFindMany.mockResolvedValue([booking()]);

    await warnBookingsAssetReinstated(ARGS);

    const sent = sendEmailMock.mock.calls[0][0];

    /**
     * These people have now had two emails telling them their gear is broken.
     * A third that reads like the first two is worse than none — it teaches
     * them to ignore the ones that matter. The subject must carry the reversal
     * on its own, because that is all most people read.
     */
    expect(sent.subject).toContain("Back in service");
    expect(sent.subject).not.toContain("out of action");
    expect(sent.subject).not.toContain("written off");
  });

  it("tells them they can stand a replacement down", async () => {
    bookingFindMany.mockResolvedValue([booking()]);

    await warnBookingsAssetReinstated(ARGS);

    const sent = sendEmailMock.mock.calls[0][0];

    // The reason the email exists: the recipient may have hired or borrowed a
    // replacement on the strength of the write-off.
    expect(sent.text).toContain("stand it down");
    // And it must not claim the item was repaired — it may still be faulty,
    // and US-012 AC5 expects a NEW fault report if it is.
    expect(sent.text).not.toContain("repaired");
  });

  it("is distinguishable from the write-off email in both subject and body", async () => {
    bookingFindMany.mockResolvedValue([booking()]);
    await warnBookingsAssetWrittenOff(ARGS);
    const writtenOff = sendEmailMock.mock.calls[0][0];

    sendEmailMock.mockClear();
    bookingFindMany.mockClear();
    bookingFindMany.mockResolvedValue([booking()]);
    await warnBookingsAssetReinstated(ARGS);
    const reinstated = sendEmailMock.mock.calls[0][0];

    // The regression this guards: a shared template whose variant branch is
    // dropped, so all three messages silently become the same email.
    expect(reinstated.subject).not.toBe(writtenOff.subject);
    expect(reinstated.text).not.toBe(writtenOff.text);
    expect(reinstated.html).not.toBe(writtenOff.html);
  });

  it("excludes the lead who reinstated it (#66, and US-012 states it)", async () => {
    bookingFindMany.mockResolvedValue([
      booking({
        custodianUser: {
          id: REPORTER_ID,
          email: "reporter@example.test",
          firstName: "Sam",
          lastName: "Whitfield",
          dateFormat: null,
          timeFormat: null,
          weekStart: null,
        },
      }),
    ]);

    await warnBookingsAssetReinstated(ARGS);

    /**
     * #260 flagged this as the one thing US-012 had to STATE rather than
     * inherit silently. The lead who just clicked Reinstate does not need an
     * email telling them what they did — and, as with US-009 AC7, a workspace
     * where they are the only recipient legitimately emails nobody.
     */
    expect(emailedAddresses()).not.toContain("reporter@example.test");
  });
});
