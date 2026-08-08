/**
 * Branding assertions for the authenticated sidebar (US-002 AC1/AC2/AC7,
 * US-006 AC1, US-008 AC1/AC2/AC7).
 *
 * The sidebar is behind auth and this instance runs with `DISABLE_SIGNUP` on,
 * so the repo's Playwright account fixture (which provisions users by
 * completing signup against a live mail service) cannot reach it — see
 * `Requirements/hcf-branding/test-plan.md`, "Not covered". Rendering the two
 * components directly is what makes the collapsed rail, the expanded lockup and
 * the AGPL menu item verifiable at all.
 *
 * The AGPL item is the one that matters most: it is a **legal** obligation
 * (AGPL-3.0 §13) whose failure mode is silent. A nullish destination renders a
 * dead control that typecheck cannot see — see
 * `.claude/rules/resolve-nullish-button-to.md` — and the item sits in a
 * dropdown nobody opens during a demo.
 *
 * @see {@link file://../../../app/components/marketing/logos.tsx}
 * @see {@link file://../../../app/components/layout/sidebar/sidebar-user-menu.tsx}
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
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

import { ShelfSidebarLogo } from "~/components/marketing/logos";
import { SidebarProvider } from "~/components/layout/sidebar/sidebar";
import SidebarUserMenu from "~/components/layout/sidebar/sidebar-user-menu";
import { config } from "~/config/shelf.config";

describe("sidebar logo (US-002 AC1, AC2, AC7)", () => {
  it("shows the full HCF lockup when expanded, height-only so the ratio holds", () => {
    render(<ShelfSidebarLogo minimized={false} />);

    const logo = screen.getByRole("img", { name: config.appName });
    expect(logo).toHaveAttribute("src", "/static/images/hcf-logo-dark.png");
    // Height-only sizing is what preserves the source 2000x387 ratio. A width
    // class here would squash the lockup — the failure AC1 exists to catch.
    expect(logo.className).toContain("h-[40px]");
    expect(logo.className).not.toMatch(/\bw-\[/);
  });

  it("swaps to the square symbol in the collapsed rail", () => {
    render(<ShelfSidebarLogo minimized={true} />);

    const logo = screen.getByRole("img", { name: config.appName });
    expect(logo).toHaveAttribute("src", "/static/images/hcf-symbol.png");
    // The collapsed rail is 48px; the wide lockup would overflow it.
    expect(logo).not.toHaveAttribute("src", "/static/images/hcf-logo-dark.png");
  });

  it.each([true, false])(
    "never announces a Shelf name (minimized=%s)",
    (minimized) => {
      render(<ShelfSidebarLogo minimized={minimized} />);

      const logo = screen.getByRole("img", { name: config.appName });
      expect(logo.getAttribute("alt")).toBe("HCF Production Stock");
      expect(logo.getAttribute("alt")?.toLowerCase()).not.toContain("shelf");
    }
  );
});

/**
 * Renders the user menu with the loader payload it reads, then opens it.
 *
 * why: the menu contents live in a Radix portal that only mounts while the
 * dropdown is open, so asserting on the closed trigger would silently assert
 * nothing.
 */
async function renderOpenUserMenu() {
  const Stub = createRoutesStub([
    {
      id: "routes/_layout+/_layout",
      path: "/",
      Component: () => (
        <SidebarProvider>
          <SidebarUserMenu />
        </SidebarProvider>
      ),
      loader: () => ({
        user: {
          username: "sbaker",
          email: "volunteer@example.org",
          firstName: "Sam",
          lastName: "Baker",
          profilePicture: null,
        },
      }),
    },
  ]);

  render(<Stub initialEntries={["/"]} />);

  await userEvent.click(
    await screen.findByRole("button", { name: /volunteer@example\.org/i })
  );

  return within(await screen.findByRole("menu"));
}

describe("AGPL source offer in the user menu (US-008)", () => {
  it("offers the source in two clicks, to a real destination (AC1)", async () => {
    const menu = await renderOpenUserMenu();

    const link = menu.getByRole("menuitem", { name: /source code/i });

    // A nullish href renders a control that looks fine and goes nowhere.
    expect(link).toHaveAttribute("href", config.sourceRepositoryUrl);
    expect(link.getAttribute("href")).toMatch(/^https:\/\/github\.com\/\S+/);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("names the upstream project and the licence (AC2, AC5)", async () => {
    const menu = await renderOpenUserMenu();

    // "Based on" is accurate attribution and implies no endorsement (AC5).
    expect(menu.getByText("Based on Shelf.nu · AGPL-3.0")).toBeInTheDocument();
  });

  it("describes its destination for a screen reader (AC7)", async () => {
    const menu = await renderOpenUserMenu();

    const link = menu.getByRole("menuitem", { name: /source code/i });
    expect(link.getAttribute("aria-label")).toMatch(/source repository/i);
    expect(link.getAttribute("aria-label")).toMatch(/new tab/i);
  });

  it("carries no Shelf commercial link beyond the AGPL attribution (US-006 AC1)", async () => {
    const menu = await renderOpenUserMenu();

    const shelfHrefs = menu
      .getAllByRole("menuitem")
      .map((el) => el.getAttribute("href") ?? "")
      .filter((href) => /shelf\.nu/i.test(href));

    expect(shelfHrefs).toEqual([]);
  });
});
