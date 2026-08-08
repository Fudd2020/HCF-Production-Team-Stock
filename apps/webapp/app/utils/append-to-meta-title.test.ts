/**
 * Page-title branding (US-001 AC1, AC2, AC6).
 *
 * `appendToMetaTitle` is the single chokepoint for ~325 route `meta` exports,
 * so one assertion here stands in for every browser tab in the product. It is
 * covered separately from the Playwright suite because that can only reach the
 * handful of routes available signed out.
 *
 * The `null` case is the one US-001 calls out as easy to miss: several routes
 * call this with no title and used to render `Not found | shelf.nu`.
 *
 * @see {@link file://./append-to-meta-title.ts}
 */
import { describe, expect, it, vi } from "vitest";

// why: `~/utils/env` reads `process.env` at import time and `shelf.config.ts`
// is built from it, so the config object cannot exist without these.
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
import { appendToMetaTitle } from "./append-to-meta-title";

describe("appendToMetaTitle", () => {
  it("suffixes the page name with the configured app name", () => {
    expect(appendToMetaTitle("Assets")).toBe("Assets | HCF Production Stock");
  });

  it.each([null, undefined, ""])(
    "falls back to 'Not found', still HCF-branded (input: %p)",
    (input) => {
      // This branch rendered "Not found | shelf.nu" before the rebrand and is
      // reached by routes that pass a loader value straight through.
      expect(appendToMetaTitle(input)).toBe("Not found | HCF Production Stock");
    }
  );

  it.each(["Assets", "Bookings", "Settings", null])(
    "never renders a Shelf name (input: %p)",
    (input) => {
      expect(appendToMetaTitle(input).toLowerCase()).not.toContain("shelf");
    }
  );

  it("derives the name from config, so changing one value changes every tab (AC6)", () => {
    // Pinning the interpolation, not the literal: a future rename must not
    // require touching 325 call sites.
    expect(appendToMetaTitle("Assets")).toBe(`Assets | ${config.appName}`);
  });
});
