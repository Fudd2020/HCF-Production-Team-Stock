/**
 * Authenticated end-to-end assertions, driven as a real `SELF_SERVICE` user.
 *
 * This is the suite that closes **N-2** and **N-4** from `test-plan.md`. Until
 * the seeded-auth fixture existed, QA had no session at all: the repo's only
 * account fixture signs up through `/join`, which `DISABLE_SIGNUP=true` blocks.
 * Everything below was previously either reasoned about from source or
 * asserted against a component rendered in isolation.
 *
 * ## Why `SELF_SERVICE` specifically
 *
 * **N-4 is the legally relevant one.** AGPL-3.0 §13 requires this instance to
 * offer its Corresponding Source to *users who interact with it over a
 * network* — all of them, not just administrators. `SELF_SERVICE` is the
 * least-privileged role in the product, so it is the one that can actually
 * fail that obligation. A component test can prove the markup exists; only a
 * signed-in browser can prove the role reaches the screen, the menu opens for
 * it, and the link has a real destination.
 *
 * The other two cases here (the HCF lockup in the sidebar, and the absence of
 * Shelf branding in the user menu) are the authenticated half of US-002 and
 * US-006 that `sidebar-branding.test.tsx` could only cover as components.
 *
 * ## Failure classes these target
 *
 * - A nullish `href`/`to` renders a dead control silently
 *   (`.claude/rules/resolve-nullish-button-to.md`) — so the link's `href` is
 *   read from the DOM, not inferred from `config`.
 * - Server-module leaks 500 the route while CI stays green
 *   (`.claude/rules/no-server-module-in-route-client-exports.md`) — reaching
 *   `/assets` at all is the check.
 * - Role gating that is only cosmetic: if the menu item were behind a
 *   permission the component test would still pass.
 *
 * Prerequisites and how to run: see `test/e2e/auth.setup.ts`.
 */

import { test, expect, type Page } from "@playwright/test";
import { E2E_ACCOUNTS, E2E_ORGANIZATION_NAME } from "./accounts";

/** The public fork offered under AGPL-3.0 §13 (decisions 11 and 12). */
const SOURCE_REPOSITORY_URL =
  "https://github.com/Fudd2020/HCF-Production-Team-Stock";

/** `config.appName` — every logo's `alt` text (US-002 AC7). */
const APP_NAME = "HCF Production Stock";

/**
 * Opens the sidebar user menu and returns its content region.
 *
 * The trigger is a Radix dropdown button carrying the signed-in user's email,
 * which is the most specific thing about it that is not a CSS class.
 *
 * why the retry: the trigger is server-rendered, so it is clickable (and takes
 * focus) before React has attached its handler. A single click lands on the
 * pre-hydration DOM and does nothing — observed here as a focused button and
 * no menu. `toPass` re-clicks until the handler exists, rather than sleeping
 * for an arbitrary interval.
 *
 * @param page - The signed-in page
 * @returns A locator for the open dropdown menu
 */
async function openUserMenu(page: Page) {
  const trigger = page.getByRole("button", {
    name: E2E_ACCOUNTS.SELF_SERVICE.email,
  });
  await expect(trigger).toBeVisible();

  const menu = page.getByRole("menu");

  await expect(async () => {
    await trigger.click();
    await expect(menu).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  return menu;
}

test.describe("SELF_SERVICE — authenticated app shell", () => {
  test.beforeEach(async ({ page }) => {
    // why: deliberately NOT `networkidle` — the authenticated shell keeps
    // long-lived connections open, so networkidle never settles and every test
    // times out in the hook. Hydration is handled where it actually matters,
    // by the re-clicking `toPass` in `openUserMenu`.
    await page.goto("/assets", { waitUntil: "domcontentloaded" });
  });

  test("reaches the app signed in, in the seeded test workspace", async ({
    page,
  }) => {
    // The whole fixture is worthless if the session silently fails open to the
    // login page, so assert the negative explicitly rather than relying on a
    // later selector timing out with a misleading message.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(/\/assets/);

    // Confirms the seeded workspace is the active one — a spec that passed
    // against somebody's real workspace would be worse than no spec.
    await expect(
      page.getByText(E2E_ORGANIZATION_NAME, { exact: false }).first()
    ).toBeVisible();
  });

  /**
   * The control for every other test in this file.
   *
   * If the seeded membership were wrong — the wrong role, or none, which
   * `resolveEffectiveRole` silently defaults to `BASE` — the session would
   * still sign in and every assertion below would pass while proving nothing
   * about `SELF_SERVICE`. So prove the privilege level *server-side* rather
   * than trusting the seeder.
   */
  test("is genuinely least-privileged, not a role that fell back", async ({
    page,
  }) => {
    // `SELF_SERVICE` holds no `location` or `teamMember` permission at all
    // (`app/utils/permissions/permission.data.ts`), so these nav entries are
    // absent for this role and present for BASE/ADMIN/OWNER.
    await expect(page.getByRole("link", { name: /^Locations$/ })).toHaveCount(
      0
    );
    await expect(page.getByRole("link", { name: /^Team$/ })).toHaveCount(0);

    // Hiding a link is not a permission check. This is the server refusing.
    const response = await page.goto("/locations", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(403);
  });

  /**
   * N-4. The AGPL obligation runs to every user of the instance, so the
   * least-privileged role must be able to reach the offer.
   */
  test("can reach the AGPL source link from the user menu", async ({
    page,
  }) => {
    const menu = await openUserMenu(page);

    const sourceLink = menu.getByRole("menuitem", {
      name: /About & source code/i,
    });

    await expect(sourceLink).toBeVisible();

    // Read the real destination out of the DOM. `config.sourceRepositoryUrl`
    // being correct is not the same claim as the anchor carrying it: a nullish
    // value renders an <a href="/"> that typecheck and unit tests both pass.
    const anchor = sourceLink.locator("a").or(sourceLink).first();
    await expect(anchor).toHaveAttribute("href", SOURCE_REPOSITORY_URL);
    await expect(anchor).toHaveAttribute("target", "_blank");
    await expect(anchor).toHaveAttribute("rel", /noopener/);

    // US-008 AC2 — the attribution has to sit with the link, not elsewhere.
    await expect(sourceLink).toContainText("Based on Shelf.nu");
    await expect(sourceLink).toContainText("AGPL-3.0");

    // US-008 AC7 — the accessible name names the destination.
    await expect(anchor).toHaveAttribute(
      "aria-label",
      /source repository on GitHub/i
    );
  });

  /**
   * N-2, US-002 AC1/AC7. The sidebar lockup rendered in the real shell, not in
   * an isolated component render.
   */
  test("renders the HCF lockup in the sidebar", async ({ page }) => {
    const logo = page.getByRole("img", { name: APP_NAME }).first();
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute("src", /hcf-logo-dark\.png$/);

    // Height-only sizing keeps the source ratio; a squashed logo is a runtime
    // property of the box that no snapshot of the markup can catch.
    const box = await logo.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(0);
    expect(box!.width / box!.height).toBeCloseTo(2000 / 387, 1);
  });

  /**
   * N-2, US-006 AC1. The sidebar and its user menu are where the Shelf store,
   * knowledge-base and support links used to live.
   */
  test("carries no shelf.nu link anywhere in the authenticated shell", async ({
    page,
  }) => {
    // The user menu renders in a portal, so open it first — its contents are
    // then part of the document and covered by the page-wide scan below.
    await openUserMenu(page);

    const html = await page.content();

    // Match on the link TARGET, not the word: the AGPL attribution legitimately
    // reads "Based on Shelf.nu · AGPL-3.0" and must survive. Scanning the whole
    // shell rather than one menu means a link re-added to the sidebar's bottom
    // menu — where the "Asset labels" → store.shelf.nu item used to sit — fails
    // here too.
    expect(html).not.toMatch(/https?:\/\/(?:[a-z0-9-]+\.)*shelf\.nu/i);
    expect(html).not.toMatch(/mailto:[^"']*@shelf\.nu/i);
  });
});
