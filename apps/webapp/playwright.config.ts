import { defineConfig, devices } from "@playwright/test";
import { storageStatePath } from "./test/e2e/accounts";

/**
 * Playwright configuration.
 *
 * Two kinds of project live here:
 *
 * - **`chromium`** — signed-out specs (e.g. `branding.spec.ts`). Needs no
 *   environment beyond a running app.
 * - **`setup` + `chromium-self-service`** — authenticated specs. `setup` mints
 *   a session cookie into a `storageState` file (see `test/e2e/auth.setup.ts`)
 *   and the role project consumes it. Authenticated specs are named
 *   `*.authenticated.spec.ts` so the signed-out project can exclude them by
 *   pattern rather than by an ever-growing list of filenames.
 *
 * Run everything with `pnpm --filter @shelf/webapp test:e2e`, which loads the
 * monorepo-root `.env` — the setup project needs `SESSION_SECRET`,
 * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE`.
 *
 * The accounts must be seeded first (idempotent, safe to repeat):
 * `pnpm --filter @shelf/webapp seed:e2e`.
 *
 * @see {@link file://./test/e2e/auth.setup.ts}
 * @see {@link file://./scripts/seed-e2e-accounts.ts}
 */

/**
 * `server/session.ts` marks the auth cookie `secure` when `NODE_ENV` is
 * `production`, and `~/utils/env` requires `NODE_ENV` to be one of its three
 * known values. Playwright does not set it, so default it here — before any
 * test file (and therefore any `~/utils/env` import) is loaded.
 */
process.env.NODE_ENV ??= "development";

/** Matches only the authenticated specs; used to include and to exclude them. */
const AUTHENTICATED_SPECS = /\.authenticated\.spec\.ts$/;

export default defineConfig({
  testDir: "./test/e2e",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: "http://127.0.0.1:3000",

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
  },

  /* Configure projects for major browsers */
  projects: [
    /**
     * Mints the session cookies the authenticated projects depend on. Not a
     * browser project: it talks to Supabase, then verifies the cookie in a
     * throwaway context.
     */
    {
      name: "setup",
      testMatch: /auth\.setup\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },

    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // Signed-out project — authenticated specs belong to the role projects.
      testIgnore: AUTHENTICATED_SPECS,
    },

    /**
     * The least-privileged role. Deliberately the first (and currently only)
     * authenticated project: anything a SELF_SERVICE user can reach, every
     * other role can too, so it is the strictest place to assert that a
     * surface is genuinely available to everyone.
     */
    {
      name: "chromium-self-service",
      testMatch: AUTHENTICATED_SPECS,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: storageStatePath("SELF_SERVICE"),
      },
    },

    // {
    //   name: "firefox",
    //   use: { ...devices["Desktop Firefox"] },
    // },

    // {
    //   name: "webkit",
    //   use: { ...devices["Desktop Safari"] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ..devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
