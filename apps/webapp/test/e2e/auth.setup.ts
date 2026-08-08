/**
 * Playwright authentication setup — mints a signed session cookie for each
 * seeded role and writes it to a `storageState` file.
 *
 * This is the piece that lets end-to-end specs reach **authenticated** surfaces
 * at all. It runs as a Playwright *setup project*; the authenticated projects
 * declare `dependencies: ["setup"]` and load the file it produces.
 *
 * ## How a session is minted without a UI or an email
 *
 * Exactly the pattern the webapp already uses for mobile SSO handoff
 * (`app/modules/auth/mobile-sso.server.ts`):
 *
 *   1. `auth.admin.generateLink({ type: "magiclink", email })` — returns a
 *      `hashed_token` without sending anything.
 *   2. `auth.verifyOtp({ token_hash, type: "magiclink" })` — exchanges it for a
 *      real Supabase session (access + refresh token).
 *
 * The webapp's own helper (`mintMobileSessionForUser`) is deliberately **not
 * exported** — it hands out a full session with no authorization check — so the
 * two calls are repeated here rather than imported. The retry/rate-limit
 * classification around them is not reproduced: a local test run against a
 * `.test` account does not need it, and a transient failure here should fail
 * the run loudly rather than be papered over.
 *
 * ## The cookie
 *
 * Produced by the app's own {@link createSessionStorage}, so the name, signing
 * secret, `httpOnly`/`sameSite`/`secure` flags and the serialisation are
 * whatever `server/session.ts` says they are today. Nothing here hand-rolls a
 * cookie, so a change to the session config cannot silently desynchronise the
 * fixture.
 *
 * The server accepts it because `protect()` in `server/middleware.ts` validates
 * the session by looking the **refresh token** up in `auth.refresh_tokens` —
 * a read, not a consume — so the minted token stays valid for the whole run.
 *
 * ## Prerequisites
 *
 * The accounts must already exist. Run once (safe to repeat):
 *
 * ```bash
 * pnpm --filter @shelf/webapp seed:e2e     # or: pnpm webapp:seed:e2e
 * pnpm --filter @shelf/webapp test:e2e     # or: pnpm webapp:test:e2e
 * ```
 *
 * `test:e2e` loads the monorepo-root `.env` through dotenv-cli; running
 * `npx playwright test` directly will fail here with "SESSION_SECRET is not
 * set" unless the environment is already populated.
 *
 * **Never commit the output.** `test/e2e/.auth/` holds live session cookies and
 * is git-ignored.
 *
 * @see {@link file://./accounts.ts} — which accounts exist
 * @see {@link file://./../../scripts/seed-e2e-accounts.ts} — creates them
 * @see {@link file://./../../server/session.ts} — the cookie contract
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { test as setup, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { authSessionKey, createSessionStorage } from "@server/session";
import type { SeedableRole } from "./accounts";
import { E2E_ACCOUNTS, storageStatePath } from "./accounts";

/**
 * Roles that get a `storageState` file, and therefore a Playwright project.
 *
 * Only `SELF_SERVICE` today — it is the least-privileged role and the one QA
 * could not otherwise reach. Adding a role here plus a project in
 * `playwright.config.ts` is all that is needed once the seeder has been run
 * with `--role=<ROLE>`.
 */
const AUTHENTICATED_ROLES: SeedableRole[] = ["SELF_SERVICE"];

/**
 * Reads the Supabase admin credentials from the environment.
 *
 * Deliberately reads `process.env` rather than `~/utils/env`'s
 * `SUPABASE_SERVICE_ROLE` export so the failure message can name the command
 * that fixes it.
 *
 * @returns URL and service-role key
 * @throws {Error} When either is missing
 */
function readSupabaseAdminEnv(): { url: string; serviceRole: string } {
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE;

  if (!url || !serviceRole) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set to mint an e2e " +
        "session. Run the suite with `pnpm --filter @shelf/webapp test:e2e`, " +
        "which loads the monorepo-root .env."
    );
  }

  return { url, serviceRole };
}

/** The subset of a Supabase session the app stores in its cookie. */
type MintedSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  expiresIn: number;
  expiresAt: number;
};

/**
 * Mints a fresh Supabase session for an existing, email-confirmed user.
 *
 * @param email - The seeded account's address
 * @returns The session fields `server/session.ts` persists
 * @throws {Error} When Supabase refuses, or returns no token/session — most
 *   often because the account has not been seeded yet
 */
async function mintSession(email: string): Promise<MintedSession> {
  const { url, serviceRole } = readSupabaseAdminEnv();

  // why: a one-shot admin client — no session persistence and no refresh timer,
  // matching `app/integrations/supabase/client.ts` and keeping the Playwright
  // worker from being held open by a background interval.
  const supabase = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: linkData, error: linkError } =
    await supabase.auth.admin.generateLink({ type: "magiclink", email });

  if (linkError) {
    throw new Error(
      `Could not generate a magic link for ${email}: ${linkError.message}. ` +
        "Has the account been seeded? Run `pnpm --filter @shelf/webapp seed:e2e`."
    );
  }

  const tokenHash = linkData.properties?.hashed_token;
  if (!tokenHash) {
    throw new Error(`Supabase returned no verifiable token for ${email}`);
  }

  const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });

  if (otpError) {
    throw new Error(
      `Could not verify the OTP for ${email}: ${otpError.message}`
    );
  }

  const session = otpData.session;
  if (!session?.user.email) {
    throw new Error(`Supabase returned no usable session for ${email}`);
  }

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    userId: session.user.id,
    email: session.user.email,
    expiresIn: session.expires_in ?? -1,
    expiresAt: session.expires_at ?? -1,
  };
}

/**
 * Serialises a minted session into the app's `__authSession` cookie value.
 *
 * Uses the app's own session storage, so the value is signed with
 * `SESSION_SECRET` and encoded exactly as the server expects. Only the
 * `name=value` pair is returned — the attributes are re-applied by Playwright
 * when the cookie is added to a context.
 *
 * @param session - The minted Supabase session
 * @returns `{ name, value }` for the auth cookie
 * @throws {Error} When the committed `Set-Cookie` header cannot be parsed
 */
async function buildAuthCookie(
  session: MintedSession
): Promise<{ name: string; value: string }> {
  const storage = createSessionStorage();
  const cookieSession = await storage.getSession();
  cookieSession.set(authSessionKey, session);

  // Mirrors the 3-day `maxAge` that `server/index.ts` applies on every commit.
  const setCookie = await storage.commitSession(cookieSession, {
    maxAge: 60 * 60 * 24 * 3,
  });

  const [pair] = setCookie.split(";");
  const separator = pair.indexOf("=");
  if (separator < 1) {
    throw new Error("Could not parse the committed session cookie");
  }

  // The value stays percent-encoded: Playwright writes cookie values verbatim
  // into the `Cookie` header, and the server decodes them on parse.
  return { name: pair.slice(0, separator), value: pair.slice(separator + 1) };
}

for (const role of AUTHENTICATED_ROLES) {
  const account = E2E_ACCOUNTS[role];
  const statePath = storageStatePath(role);

  setup(`authenticate as ${role}`, async ({ browser, baseURL }) => {
    if (!baseURL) {
      throw new Error("playwright.config.ts must define use.baseURL");
    }

    // A production build marks the session cookie `secure`, which a browser
    // will not send over plain http — the run would fail as "not signed in"
    // with no hint why. Fail here instead, naming the cause.
    if (
      process.env.NODE_ENV === "production" &&
      baseURL.startsWith("http://")
    ) {
      throw new Error(
        "NODE_ENV=production makes the auth cookie Secure-only, so it cannot " +
          `be sent to ${baseURL}. Run the e2e suite against a dev server.`
      );
    }

    const session = await mintSession(account.email);
    const { name, value } = await buildAuthCookie(session);

    const context = await browser.newContext({ baseURL });
    await context.addCookies([
      {
        name,
        value,
        url: baseURL,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    // Prove the cookie actually authenticates before writing it out. Without
    // this, a broken session surfaces as every authenticated spec redirecting
    // to /login, which reads like an app bug rather than a fixture bug.
    const page = await context.newPage();
    await page.goto("/assets", { waitUntil: "domcontentloaded" });
    await expect(
      page,
      `The minted session for ${account.email} was rejected — the app redirected to login.`
    ).not.toHaveURL(/\/login/);

    await mkdir(dirname(statePath), { recursive: true });
    await context.storageState({ path: statePath });
    await context.close();
  });
}
