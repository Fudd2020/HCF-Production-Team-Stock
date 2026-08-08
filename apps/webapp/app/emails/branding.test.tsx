/**
 * Branding assertions for the transactional email surface (US-004).
 *
 * These are behaviour tests on the *rendered* output — the string a recipient's
 * mail client actually receives — rather than on how the templates are built.
 * They exist because the failure mode this story fixes was invisible to
 * typecheck and to every existing test: `logo.tsx` hardcoded Shelf's artwork
 * while reading `config.logoPath` two lines below, so rebranding the config
 * rebranded every logo in the product except the one in emails.
 *
 * HTML and plain-text bodies are asserted as a pair wherever a template exports
 * both, because US-004 AC7 requires them to carry the same naming and they are
 * separate strings that drift independently.
 *
 * @see {@link file://./logo.tsx}
 * @see {@link file://./invite-template.tsx}
 * @see {@link file://../config/shelf.config.ts}
 */
import type { Invite, Organization, User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

// why: `~/utils/env` reads `process.env` at import time and `shelf.config.ts`
// imports from it, so the config object cannot be built without these. Pinning
// SERVER_URL also lets the logo `src` assertion be exact.
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
import { inviteEmailText, roleChangeEmailText } from "~/modules/invite/helpers";
import {
  changeEmailAddressHtmlEmail,
  changeEmailAddressTextEmail,
} from "./change-user-email-address";
import { invitationTemplateString } from "./invite-template";
import { lowStockAlertHtml, lowStockAlertText } from "./low-stock-alert";
import {
  lowStockRecoveredHtml,
  lowStockRecoveredText,
} from "./low-stock-recovered";
import { onboardingEmailText } from "./onboarding-email";
import { roleChangeTemplateString } from "./role-change-template";

/**
 * Minimal invite fixture. Only the fields the template reads are meaningful;
 * the rest satisfy the Prisma types.
 */
function buildInvite(overrides: Partial<Organization> = {}): Invite & {
  inviter: Pick<User, "firstName" | "lastName" | "displayName">;
  organization: Organization;
} {
  return {
    id: "invite-1",
    inviteeEmail: "volunteer@example.org",
    inviter: { firstName: "Sam", lastName: "Baker", displayName: null },
    organization: {
      id: "org-1",
      name: "HCF Production",
      customEmailFooter: null,
      ...overrides,
    } as Organization,
  } as Invite & {
    inviter: Pick<User, "firstName" | "lastName" | "displayName">;
    organization: Organization;
  };
}

const lowStockProps = {
  assetTitle: "Shure SM58",
  available: 2,
  minQuantity: 5,
  unitOfMeasure: "units",
  assetId: "asset-1",
  organizationName: "HCF Production",
};

describe("transactional email branding", () => {
  describe("the logo block (AC3, TL-5)", () => {
    it("points at the configured logo, not a hardcoded path", async () => {
      const html = await invitationTemplateString({
        invite: buildInvite(),
        token: "tok",
      });

      // The bug this story fixes: the src was literal Shelf artwork while the
      // config said otherwise.
      expect(html).toContain(
        `https://stock.example.org${config.logoPath?.fullLogo}`
      );
      expect(html).not.toContain("logo-full-color");
    });

    it("names the app in the alt text, so a blocked-image inbox reads as HCF", async () => {
      const html = await invitationTemplateString({
        invite: buildInvite(),
        token: "tok",
      });

      expect(html).toContain(`alt="${config.appName}"`);
    });
  });

  describe("the invitation email (AC1, AC6, AC7, AC8)", () => {
    it("carries no Shelf branding in the HTML or the plain text", async () => {
      const html = await invitationTemplateString({
        invite: buildInvite(),
        token: "tok",
      });
      const text = inviteEmailText({ invite: buildInvite(), token: "tok" });

      expect(html).not.toMatch(/shelf/i);
      expect(text).not.toMatch(/shelf/i);
    });

    it("names the app and signs off as the production team, in both parts", async () => {
      const html = await invitationTemplateString({
        invite: buildInvite(),
        token: "tok",
      });
      const text = inviteEmailText({ invite: buildInvite(), token: "tok" });

      for (const body of [html, text]) {
        expect(body).toContain(config.appName);
        expect(body).toContain("HCF Production Team");
      }
    });

    it("offers help from the production team at the configured address", async () => {
      const html = await invitationTemplateString({
        invite: buildInvite(),
        token: "tok",
      });
      const text = inviteEmailText({ invite: buildInvite(), token: "tok" });

      // The exact sentence signed off in design.md — no "please", no
      // "support team", no exclamation mark.
      const sentence =
        "If something doesn't work, or you're not sure what to do, email production@example.org and someone on the production team will help.";

      expect(text).toContain(sentence);
      // The HTML renderer escapes the apostrophes and may wrap lines, so match
      // the two halves either side of the interpolated address instead.
      expect(html).toContain("production@example.org");
      expect(html).toMatch(/someone on the production team will help/);
    });

    it("tells the recipient how to add it to their phone's home screen", async () => {
      const html = await invitationTemplateString({
        invite: buildInvite(),
        token: "tok",
      });
      const text = inviteEmailText({ invite: buildInvite(), token: "tok" });

      for (const body of [html, text]) {
        expect(body).toMatch(/Add to Home Screen/);
      }
    });

    it("still renders a workspace's custom email footer (AC8)", async () => {
      const html = await invitationTemplateString({
        invite: buildInvite({ customEmailFooter: "Ask Sam in the sound desk" }),
        token: "tok",
      });

      expect(html).toContain("Ask Sam in the sound desk");
    });

    it("renders extraMessage as literal text, never as a Markdoc tag or markup", async () => {
      // why: `extraMessage` is user-authored free text. It is a plain <Text>
      // node by design — see .claude/rules/sanitize-note-content-markdoc.md.
      // This pins that it stays one: an injected tag or element must survive
      // as visible characters, not as live markup.
      const payload = '{% link to="javascript:alert(1)" /%}<b>bold</b>';

      const html = await invitationTemplateString({
        invite: buildInvite(),
        token: "tok",
        extraMessage: payload,
      });

      expect(html).not.toContain("<b>bold</b>");
      expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
      expect(html).toContain("javascript:alert(1)");
      expect(html).not.toContain('href="javascript:alert(1)"');
    });
  });

  describe("the other templates (AC4, AC7)", () => {
    it("role change: no Shelf branding, HCF sign-off, in both parts", async () => {
      const html = await roleChangeTemplateString({
        orgName: "HCF Production",
        previousRole: "Base",
        newRole: "Admin",
        recipientEmail: "volunteer@example.org",
      });
      const text = roleChangeEmailText({
        orgName: "HCF Production",
        previousRole: "Base",
        newRole: "Admin",
      });

      for (const body of [html, text]) {
        expect(body).not.toMatch(/shelf/i);
        expect(body).toContain("HCF Production Team");
      }
    });

    it("change email address: no Shelf branding, HCF sign-off, in both parts", async () => {
      const user = {
        firstName: "Sam",
        lastName: "Baker",
        displayName: null,
        email: "volunteer@example.org",
      };
      const html = await changeEmailAddressHtmlEmail("123456", user);
      const text = changeEmailAddressTextEmail({ otp: "123456", user });

      for (const body of [html, text]) {
        expect(body).not.toMatch(/shelf/i);
        expect(body).toContain("HCF Production Team");
      }
    });

    it("low stock alert: no Shelf branding, HCF sign-off, in both parts", async () => {
      const html = await lowStockAlertHtml(lowStockProps);
      const text = lowStockAlertText(lowStockProps);

      for (const body of [html, text]) {
        // The fixture asset is a "Shure SM58" — deliberately close to "Shelf"
        // so a sloppy substring check would not pass by accident.
        expect(body).not.toMatch(/shelf/i);
        expect(body).toContain("HCF Production Team");
      }
    });

    it("low stock recovered: no Shelf branding, HCF sign-off, in both parts", async () => {
      const html = await lowStockRecoveredHtml(lowStockProps);
      const text = lowStockRecoveredText(lowStockProps);

      for (const body of [html, text]) {
        expect(body).not.toMatch(/shelf/i);
        expect(body).toContain("HCF Production Team");
      }
    });

    it("onboarding: is no longer a signed letter from a Shelf co-founder (AC5)", () => {
      const text = onboardingEmailText({ firstName: "Sam" });

      expect(text).not.toMatch(/shelf/i);
      expect(text).not.toMatch(/carlos/i);
      expect(text).toContain(config.appName);
      expect(text).toContain("HCF Production Team");
    });
  });
});
