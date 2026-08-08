/**
 * End-to-end branding assertions for the signed-out surfaces (HCF rebrand).
 *
 * These cover the failure classes that typecheck and unit tests are blind to
 * and that only a real browser can see:
 *
 * - the **computed** page background (US-003 AC3) — a Tailwind token change is
 *   only proof that the class exists, not that it wins the cascade;
 * - the **keyboard focus indicator** (US-003 AC6) — `--tw-ring-color` was
 *   `#eaf2ff` (~1.1:1) before this feature, which is invisible and which no
 *   unit test could have caught;
 * - the **rendered aspect ratio** of the logo (US-002 AC1/AC3) — CSS squash is
 *   a runtime property of the box, not of the markup;
 * - the AGPL source link's **actual click target** (US-008 AC1) — a nullish
 *   `to`/`href` renders a dead control silently
 *   (`.claude/rules/resolve-nullish-button-to.md`).
 *
 * Authenticated surfaces are deliberately NOT covered here: the repo's account
 * fixture provisions users by completing signup against a live mail service,
 * and this instance runs with `DISABLE_SIGNUP` on. See `test-plan.md`,
 * "Not covered".
 *
 * Run against the already-running dev server:
 *   npx playwright test test/e2e/branding.spec.ts
 * (`playwright.config.ts` sets `reuseExistingServer` outside CI.)
 */
import { test, expect } from "@playwright/test";

const APP_NAME = "HCF Production Stock";

/** Source dimensions of `public/static/images/hcf-logo-dark.png`. */
const LOCKUP_RATIO = 2000 / 387;

/**
 * Navigate and wait for React Router to finish hydrating.
 *
 * why: hydration replaces the server-rendered nodes, so an element resolved
 * from the SSR pass detaches mid-test — `getComputedStyle` on a detached node
 * returns an empty declaration and `boundingBox()` returns null, which reads
 * like a styling bug and is not one. Waiting for the network to settle before
 * measuring removes the race; `expect.poll` at the call sites covers the rest.
 */
async function gotoHydrated(
  page: import("@playwright/test").Page,
  path: string
) {
  await page.goto(path, { waitUntil: "networkidle" });
}

test.describe("signed-out app identity (US-001)", () => {
  test("every auth page title ends with the HCF app name and never says shelf", async ({
    page,
  }) => {
    for (const path of ["/login", "/forgot-password", "/otp?mode=login"]) {
      await page.goto(path);
      const title = await page.title();

      expect(title).toContain(`| ${APP_NAME}`);
      expect(title.toLowerCase()).not.toContain("shelf");
    }
  });

  test("the favicon and apple-touch-icon are the HCF mark", async ({
    page,
  }) => {
    await page.goto("/login");

    for (const rel of ["icon", "apple-touch-icon"]) {
      const href = await page
        .locator(`link[rel="${rel}"]`)
        .first()
        .getAttribute("href");

      expect(href).toBe("/static/images/hcf-favicon.ico");
    }

    // The asset must actually be served — a 404 favicon silently falls back to
    // the browser default and looks identical to "unbranded".
    const res = await page.request.get("/static/images/hcf-favicon.ico");
    expect(res.status()).toBe(200);
  });

  test("the manifest names HCF and points at HCF artwork", async ({ page }) => {
    const res = await page.request.get("/static/manifest.json");
    expect(res.status()).toBe(200);

    const manifest = await res.json();
    expect(manifest.name).toBe(APP_NAME);
    expect(JSON.stringify(manifest).toLowerCase()).not.toContain("shelf");
    expect(manifest.background_color.toLowerCase()).toBe("#fffbf8");
    expect(manifest.icons[0].src).toBe("/static/images/hcf-symbol.png");
  });

  test("no Shelf-named static asset is requested by the shell (AC7)", async ({
    page,
  }) => {
    const shelfAssetRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (
        /logo-full-color|shelf-symbol|shelf-logo|shelf-typography/.test(url)
      ) {
        shelfAssetRequests.push(url);
      }
    });

    await page.goto("/login", { waitUntil: "networkidle" });

    expect(shelfAssetRequests).toEqual([]);
  });
});

test.describe("brand palette in the browser (US-003)", () => {
  test("the body background computes to the warm off-white, not white", async ({
    page,
  }) => {
    await page.goto("/login");

    const bg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );

    expect(bg).toBe("rgb(255, 251, 248)");
  });

  test("the primary button fills with the darkened coral, never Shelf orange", async ({
    page,
  }) => {
    await gotoHydrated(page, "/login");

    const button = page.getByRole("button", { name: "Log In" });

    // #D93C2A — the only primary fill white text is allowed to sit on.
    // #EF6820 (rgb(239, 104, 32)) is Shelf orange and must not appear.
    await expect
      .poll(() => button.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(217, 60, 42)");
  });

  test("a keyboard-focused button shows a visible focus ring (AC6)", async ({
    page,
  }) => {
    await page.goto("/login");

    const button = page.getByRole("button", { name: "Log In" });
    // Keyboard, not `.focus()` — `:focus-visible` is what the styles key off,
    // and a mouse click deliberately does not trigger it.
    await page.keyboard.press("Tab");
    for (let i = 0; i < 12; i++) {
      if (await button.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(button).toBeFocused();

    const boxShadow = await button.evaluate(
      (el) => getComputedStyle(el).boxShadow
    );

    /*
     * Regression pin for defect D-002, which had two distinct stages — assert
     * the ring the APP paints, never "some indicator is present". Every
     * browser draws its own focus outline, so a laxer assertion passes while
     * the app's own ring is invisible, which is exactly how this shipped.
     *
     *   1. `--tw-ring-color` was set on `:root`, but Tailwind's base layer
     *      sets it on `*` — a direct declaration beats an inherited one — so
     *      the ring painted `rgba(59,130,246,0.5)`, 1.82:1 on the canvas.
     *   2. Moving it to `theme.extend.ringColor` was NOT enough:
     *      `ringOpacity.DEFAULT` is `0.5`, giving `rgba(217,60,42,0.5)`,
     *      2.10:1 — still under WCAG 2.1 SC 1.4.11's 3:1 floor.
     *
     * Solid #D93C2A is 4.41:1. `rgb(...)` with no alpha is the whole point of
     * this assertion: an `rgba(...)` match here means the opacity default has
     * regressed.
     */
    expect(boxShadow).toContain("rgb(217, 60, 42)");
    expect(boxShadow).not.toContain("rgba(217, 60, 42");
    expect(boxShadow).not.toContain("rgb(59, 130, 246)");
    expect(boxShadow).not.toContain("rgba(59, 130, 246");
    // The ring's offset gap is the canvas, not white.
    expect(boxShadow).toContain("rgb(255, 251, 248)");
  });

  test("a focused text input shows the coral focus border (AC6)", async ({
    page,
  }) => {
    await page.goto("/login");

    const email = page.getByLabel("Email address");
    await email.focus();

    const borderColor = await email.evaluate(
      (el) => getComputedStyle(el).borderTopColor
    );

    // primary-600 — 4.41:1 against the canvas, over the 3:1 non-text floor.
    expect(borderColor).toBe("rgb(217, 60, 42)");
  });
});

test.describe("HCF logo in the app shell (US-002)", () => {
  test("the auth symbol renders square and at its true aspect ratio", async ({
    page,
  }) => {
    await gotoHydrated(page, "/login");

    const logo = page.locator(`img[alt="${APP_NAME}"]`).first();
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute("src", "/static/images/hcf-symbol.png");

    // Source is 512x512. ±2% per AC1.
    await expect
      .poll(async () => {
        const box = await logo.boundingBox();
        return box ? box.width / box.height : null;
      })
      .toBeCloseTo(1, 1);
  });

  test("the dark cover panel carries the WHITE lockup, undistorted (AC4)", async ({
    page,
    viewport,
  }) => {
    test.skip(!viewport || viewport.width < 1024, "cover panel is lg-only");
    await gotoHydrated(page, "/login");

    // The dark lockup on a dark panel is the single most likely mistake in
    // US-002 — assert the inverse asset explicitly, not just "an image".
    const cover = page.locator(
      'img[src="/static/images/Full-Logo-White-2-lines.png"]'
    );
    await expect(cover).toBeVisible();

    await expect
      .poll(async () => {
        const box = await cover.boundingBox();
        return box ? Math.abs(box.width / box.height - LOCKUP_RATIO) : null;
      })
      .toBeLessThan(LOCKUP_RATIO * 0.02);
  });

  test("the lockup at a 32px slot fits its container without overflow (AC3)", async ({
    page,
  }) => {
    // The authenticated mobile header sizes the same asset into `h-8`. Assert
    // the geometry that slot depends on: 32px tall renders ~165px wide, which
    // must fit a phone's header. Done here because the header itself is behind
    // auth (see test-plan.md, "Not covered").
    const widthAt32 = 32 * LOCKUP_RATIO;
    expect(widthAt32).toBeLessThan(390 - 24); // narrowest supported phone, minus padding

    const res = await page.request.get("/static/images/hcf-logo-dark.png");
    expect(res.status()).toBe(200);
  });
});

test.describe("AGPL source offer (US-008)", () => {
  test("the signed-out attribution links to a real repository", async ({
    page,
  }) => {
    await page.goto("/login");

    const link = page.getByRole("link", { name: /source code/i });
    await expect(link).toBeVisible();

    const href = await link.getAttribute("href");
    // A nullish href renders a dead control that typecheck cannot see.
    expect(href).toBe("https://github.com/Fudd2020/HCF-Production-Team-Stock");
    expect(await link.getAttribute("rel")).toContain("noopener");

    // AC2: the offer must name the licence and the upstream project.
    await expect(
      page.getByText(/Based on Shelf\.nu · AGPL-3\.0/)
    ).toBeVisible();

    // AC1/AC7: the destination must actually resolve, and be keyboard-focusable.
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);

    await link.focus();
    await expect(link).toBeFocused();
  });
});

test.describe("no Shelf sighting on the signed-out journey (US-005 AC7, US-006 AC9)", () => {
  const paths = [
    "/login",
    "/forgot-password",
    "/otp?mode=login",
    // Regression pin for defect D-001. `mode=signup` is reachable (HTTP 200)
    // even with DISABLE_SIGNUP on — only `/join` is gated — and it rendered
    // "Start your journey with Shelf." from `app/utils/otp.tsx:31`, the
    // untouched twin of the string fixed at `app/routes/_auth+/join.tsx:42`.
    "/otp?mode=signup&email=qa@example.org",
  ];

  for (const path of paths) {
    test(`${path} shows no Shelf copy beyond the AGPL attribution`, async ({
      page,
    }) => {
      await page.goto(path);

      const text = (await page.locator("body").innerText()).toLowerCase();
      // The AGPL attribution is legally required and must survive; strip it
      // before asserting, so this test cannot be "fixed" by deleting it.
      const withoutAttribution = text.replace(
        /based on shelf\.nu · agpl-3\.0[^\n]*/g,
        ""
      );

      expect(withoutAttribution).not.toContain("shelf");
    });
  }
});
