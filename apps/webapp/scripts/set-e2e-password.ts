/**
 * Sets a password on a seeded E2E account so a HUMAN can log in.
 *
 * `seed-e2e-accounts.ts` deliberately creates its Supabase Auth users with **no
 * password**: Playwright mints sessions with the admin
 * `generateLink` → `verifyOtp` pattern (`test/e2e/auth.setup.ts`), so a
 * credential would be an extra secret for no benefit.
 *
 * That is correct for the test suite and useless for a person. The seeded
 * addresses are on the `.test` TLD, which by RFC 2606 can never receive mail,
 * so the magic-link and OTP flows are both dead ends in a browser. This script
 * closes that gap for **interactive local development only**.
 *
 * ## Safety
 *
 * - It refuses any address that is not on {@link E2E_EMAIL_DOMAIN}. It cannot
 *   be pointed at a real user, including your own, by mistake or by typo.
 * - It **generates** the password and prints it once. Nothing is written to
 *   disk, so there is no credential to leak from the repo, and re-running
 *   simply issues a new one.
 * - It writes to whichever Supabase project `.env`/`.env.local` points at.
 *   Auth is shared with the hosted project even when the DATABASE_URL is local
 *   — that is the whole shape of the local-dev setup — so this DOES touch the
 *   hosted auth store. It touches only synthetic `.test` accounts.
 * - `pnpm clean:e2e` removes these users entirely, password and all.
 *
 * ## Usage
 *
 * ```bash
 * # from apps/webapp, against the local database
 * pnpm e2e:password:local -- --role=OWNER
 * pnpm e2e:password:local -- --role=SELF_SERVICE
 * ```
 *
 * @see {@link file://./seed-e2e-accounts.ts} — creates the accounts
 * @see {@link file://./../test/e2e/accounts.ts} — the synthetic identifiers
 */

import { randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import {
  E2E_ACCOUNTS,
  E2E_EMAIL_DOMAIN,
  SEEDABLE_ROLES,
  type SeedableRole,
} from "../test/e2e/accounts";

/** Reads a `--flag=value` argument. */
function flag(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

/**
 * A password that satisfies Supabase's default policy without a stored secret.
 *
 * 24 bytes of CSPRNG output in base64url, plus a fixed suffix guaranteeing the
 * symbol/digit classes some policies demand. Printed once, never persisted.
 */
function generatePassword(): string {
  return `${randomBytes(24).toString("base64url")}-7aA!`;
}

async function main() {
  const roleArg = (flag("role") ?? "OWNER").toUpperCase() as SeedableRole;

  if (!SEEDABLE_ROLES.includes(roleArg)) {
    throw new Error(
      `Unknown role "${roleArg}". Expected one of: ${SEEDABLE_ROLES.join(", ")}`
    );
  }

  const { email } = E2E_ACCOUNTS[roleArg];

  /**
   * The guard that makes this script safe to exist at all. Without it, a typo
   * in `--role` handling or a future refactor of `E2E_ACCOUNTS` could reset the
   * password of a real account in the hosted project.
   */
  if (!email.endsWith(`@${E2E_EMAIL_DOMAIN}`)) {
    throw new Error(
      `Refusing to touch ${email}: not on the synthetic ${E2E_EMAIL_DOMAIN} domain.`
    );
  }

  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE;

  if (!url || !serviceRole) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set. Run this through " +
        "`pnpm e2e:password:local`, which loads .env.local."
    );
  }

  const supabase = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Find the auth user by address. `listUsers` is paged; these accounts are
  // few and recent, so the first page is sufficient in practice — but fail
  // loudly rather than silently "not found" if that ever stops being true.
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) {
    throw new Error(`Could not list auth users: ${error.message}`);
  }

  const user = data.users.find((candidate) => candidate.email === email);

  if (!user) {
    throw new Error(
      `No Supabase auth user for ${email}. Run \`pnpm seed:e2e:local\` first.`
    );
  }

  const password = generatePassword();

  const { error: updateError } = await supabase.auth.admin.updateUserById(
    user.id,
    { password }
  );

  if (updateError) {
    throw new Error(`Could not set the password: ${updateError.message}`);
  }

  // Printed ONCE. Not written anywhere — re-run to issue a new one.
  console.log(`\n=== Login ready — ${roleArg} ===\n`);
  console.log(`  URL:      http://localhost:3000/login`);
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}\n`);
  console.log(
    "Not stored anywhere. Re-run this command to issue a fresh one.\n"
  );
}

main().catch((cause: unknown) => {
  console.error(
    `\nFailed: ${cause instanceof Error ? cause.message : String(cause)}\n`
  );
  process.exit(1);
});
