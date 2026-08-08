/**
 * QA branding assertions for the two transactional templates that need a real
 * Booking / Audit to render (US-004 AC1–AC4, AC7).
 *
 * `app/emails/branding.test.tsx` (written by shelf-backend-dev) renders every
 * template that takes a cheap fixture. The booking and audit templates were
 * left to a *source scan* (`subject-lines.test.ts`) because their props are
 * Prisma payloads. A source scan cannot see the three shared footers those
 * templates compose in (`components/footers.tsx`), the CTA button colour that
 * comes from `styles.ts`, or the `<title>` — all of which are AC4 surfaces.
 *
 * These tests therefore render the real templates with a hand-built payload and
 * assert on the string a mail client receives, exercising all three footer
 * branches (user / admin / notification-reason).
 *
 * @see {@link file://./bookings-updates-template.tsx}
 * @see {@link file://./audit-updates-template.tsx}
 * @see {@link file://./components/footers.tsx}
 */
import type { ResolvedFormatPrefs } from "@shelf/datetime";
import { describe, expect, it, vi } from "vitest";

// why: `~/utils/env` reads `process.env` at import time and `shelf.config.ts`
// imports from it, so the config object cannot be built without these. Pinning
// SERVER_URL also lets the logo `src` assertion be exact. Mirrors the mock in
// `branding.test.tsx` so the two suites agree on the environment.
vi.mock("~/utils/env", () => ({
  SERVER_URL: "https://stock.example.org",
  SUPPORT_EMAIL: "production@example.org",
  SEND_ONBOARDING_EMAIL: false,
  ENABLE_PREMIUM_FEATURES: false,
  FREE_TRIAL_DAYS: "7",
  DISABLE_SIGNUP: false,
  DISABLE_SSO: false,
  ENABLE_SCIM: false,
  SHOW_HOW_DID_YOU_FIND_US: false,
  COLLECT_BUSINESS_INTEL: false,
  GEOCODING_USER_AGENT: "",
}));

import { config } from "~/config/shelf.config";
import type { AuditForEmail } from "./audit-updates-template";
import { auditUpdatesTemplateString } from "./audit-updates-template";
import { bookingUpdatesTemplateString } from "./bookings-updates-template";
import type { BookingForEmail } from "./types";

const prefs: ResolvedFormatPrefs = {
  dateFormat: "DD_MM_YYYY",
  timeFormat: "H24",
  weekStartsOn: 1,
  timeZone: "Europe/London",
};

/**
 * Minimal booking payload. Only the fields the template reads are meaningful;
 * the cast satisfies the generated Prisma payload type without dragging a
 * database into a rendering test.
 */
function buildBooking(
  overrides: Partial<{ customEmailFooter: string | null }> = {}
): BookingForEmail {
  return {
    id: "booking-1",
    name: "Sunday morning — main auditorium",
    organizationId: "org-1",
    from: new Date("2026-09-06T08:00:00.000Z"),
    to: new Date("2026-09-06T13:00:00.000Z"),
    custodianUser: {
      email: "volunteer@example.org",
      firstName: "Sam",
      lastName: "Baker",
      displayName: null,
    },
    custodianTeamMember: null,
    organization: {
      name: "HCF Production",
      customEmailFooter: null,
      owner: { email: "owner@example.org" },
      ...overrides,
    },
  } as unknown as BookingForEmail;
}

const audit: AuditForEmail = {
  id: "audit-1",
  name: "Radio mic rack audit",
  description: null,
  dueDate: new Date("2026-09-10T18:00:00.000Z"),
  organizationId: "org-1",
  organization: {
    name: "HCF Production",
    customEmailFooter: null,
    owner: { email: "owner@example.org" },
  },
  _count: { assets: 12 },
  createdBy: { firstName: "Sam", lastName: "Baker", displayName: null },
};

describe("booking update emails carry HCF branding (US-004 AC1–AC4)", () => {
  it.each([
    ["user footer", { isAdminEmail: false }],
    ["admin footer", { isAdminEmail: true }],
    [
      "notification-reason footer",
      { recipientReason: "custodian", recipientEmail: "volunteer@example.org" },
    ],
  ])("has no Shelf branding with the %s", async (_label, footerProps) => {
    const html = await bookingUpdatesTemplateString({
      booking: buildBooking(),
      heading: "Your booking is confirmed",
      assetCount: 3,
      prefs,
      ...footerProps,
    });

    expect(html).not.toMatch(/shelf/i);
    // The three footers each used to end with "© <year> Shelf.nu" (DECISIONS
    // #26). Assert the whole copyright line is gone, not just the word.
    expect(html).not.toMatch(/©/);
  });

  it("titles the message with the app name and shows the HCF logo", async () => {
    const html = await bookingUpdatesTemplateString({
      booking: buildBooking(),
      heading: "Your booking is confirmed",
      assetCount: 3,
      prefs,
    });

    expect(html).toContain(`Booking update from ${config.appName}`);
    expect(html).toContain(
      `https://stock.example.org${config.logoPath?.fullLogo}`
    );
    expect(html).toContain(`alt="${config.appName}"`);
  });

  it("renders the CTA on the darkened coral so white text clears AA (AC2)", async () => {
    const html = await bookingUpdatesTemplateString({
      booking: buildBooking(),
      heading: "Your booking is confirmed",
      assetCount: 3,
      prefs,
    });

    // `emailPrimaryColor` is #D93C2A — 4.5:1+ under white. The bright accent
    // #FF4631 is 3.40:1 and must never carry white button text.
    expect(html.toLowerCase()).toContain(
      config.emailPrimaryColor.toLowerCase()
    );
    expect(html.toLowerCase()).not.toContain("#ef6820");
  });

  it("still renders a workspace's custom email footer (AC8)", async () => {
    const html = await bookingUpdatesTemplateString({
      booking: buildBooking({ customEmailFooter: "Ask Sam at the sound desk" }),
      heading: "Your booking is confirmed",
      assetCount: 3,
      prefs,
    });

    expect(html).toContain("Ask Sam at the sound desk");
  });
});

describe("audit update emails carry HCF branding (US-004 AC1–AC4)", () => {
  it("has no Shelf branding and no copyright line", async () => {
    const html = await auditUpdatesTemplateString({
      audit,
      heading: "An audit has been assigned to you",
      assetCount: 12,
      prefs,
    });

    expect(html).not.toMatch(/shelf/i);
    expect(html).not.toMatch(/©/);
  });

  it("titles the message with the app name and shows the HCF logo", async () => {
    const html = await auditUpdatesTemplateString({
      audit,
      heading: "An audit has been assigned to you",
      assetCount: 12,
      prefs,
    });

    expect(html).toContain(`Audit update from ${config.appName}`);
    expect(html).toContain(
      `https://stock.example.org${config.logoPath?.fullLogo}`
    );
  });

  it("renders the completion variant (receipt link) without Shelf branding", async () => {
    const html = await auditUpdatesTemplateString({
      audit,
      heading: "Audit complete",
      assetCount: 12,
      prefs,
      completedAt: new Date("2026-09-11T09:00:00.000Z"),
      wasOverdue: true,
    });

    expect(html).not.toMatch(/shelf/i);
    expect(html.toLowerCase()).not.toContain("#ef6820");
  });
});
