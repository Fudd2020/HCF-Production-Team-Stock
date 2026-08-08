/**
 * End-to-end test account seeder.
 *
 * Creates (or removes) the small set of accounts Playwright needs in order to
 * drive **authenticated** surfaces: a Supabase Auth user, the matching Prisma
 * `User`, one dedicated `Organization`, its `UserOrganization` membership and a
 * `TeamMember` row, per requested org role.
 *
 * This exists because the repo's only other way of getting a signed-in browser
 * (`test/fixtures/account.ts`) signs up **through the UI** at `/join`, which
 * `DISABLE_SIGNUP=true` now blocks outright, then reads a magic link by driving
 * a browser through `ethereal.email`. That fixture is externally dependent,
 * slow, flaky and can only ever produce OWNER accounts. It is left in place but
 * nothing here builds on it.
 *
 * ## Safety
 *
 * This writes to whichever Supabase project + database `.env` points at, which
 * on a developer machine is a real project. It is therefore deliberately
 * conservative:
 *
 * - Every identifier is unmistakably synthetic (`.test` TLD, `[E2E]` prefix,
 *   fixed non-cuid org id) — see `test/e2e/accounts.ts`.
 * - It is **idempotent**: re-running creates nothing twice.
 * - It creates a **dedicated workspace** and never touches an existing one.
 *   It seeds no assets, kits or bookings.
 * - `--clean` deletes only rows it owns: the fixed org id and the exact seeded
 *   email addresses. There is no unscoped `deleteMany` anywhere in this file.
 * - It refuses to run against `NODE_ENV=production` without an explicit flag.
 * - It never prints the service-role key or any session token.
 *
 * ## Usage
 *
 * ```bash
 * # from apps/webapp
 * pnpm seed:e2e                          # seeds SELF_SERVICE (+ the OWNER that owns the org)
 * pnpm seed:e2e -- --role=BASE,ADMIN     # seeds other roles too
 * pnpm seed:e2e -- --dry-run             # prints the plan, writes nothing
 * pnpm clean:e2e                         # removes everything this script created
 *
 * # or from the monorepo root
 * pnpm webapp:seed:e2e
 * pnpm webapp:clean:e2e
 * ```
 *
 * Design note: uses `createDatabaseClient()` directly rather than the webapp's
 * `app/database/db.server.ts` wrapper, which references browser globals and
 * does not work in a plain Node script — the same reason
 * `seed-reporting-demo.ts` does it this way.
 *
 * @see {@link file://./../test/e2e/accounts.ts} — the account definitions
 * @see {@link file://./../test/e2e/auth.setup.ts} — turns these accounts into a session
 */

import { createDatabaseClient } from "@shelf/database";
import type { ExtendedPrismaClient } from "@shelf/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

import type { E2EAccount, SeedableRole } from "../test/e2e/accounts";
import {
  E2E_ACCOUNTS,
  E2E_ORGANIZATION_ID,
  E2E_ORGANIZATION_NAME,
  isSeedableRole,
  SEEDABLE_ROLES,
} from "../test/e2e/accounts";

const USAGE = `
Usage: tsx scripts/seed-e2e-accounts.ts [options]

Creates the Supabase Auth users, Prisma users, dedicated test organisation and
memberships that the Playwright authenticated projects sign in as.

Options:
  --role=<ROLE[,ROLE...]>   Roles to seed. Repeatable. Default: SELF_SERVICE.
                            One of: ${SEEDABLE_ROLES.join(", ")}
  --clean                   Remove everything this script creates, then exit.
  --dry-run                 Print the plan without writing anything.
  --i-know-what-im-doing    Required to run with NODE_ENV=production.
  -h, --help                Show this message.

Everything created lives in organisation "${E2E_ORGANIZATION_NAME}"
(id: ${E2E_ORGANIZATION_ID}) and uses @${
  E2E_ACCOUNTS.SELF_SERVICE.email.split("@")[1]
} addresses.
`;

/** Parsed command-line options. */
type CliOptions = {
  roles: SeedableRole[];
  clean: boolean;
  dryRun: boolean;
  iKnowWhatImDoing: boolean;
};

/** Thrown when `--help` is passed, so `main` can print usage and exit 0. */
class HelpRequested extends Error {}

/**
 * Parses `process.argv` into typed options.
 *
 * @param argv - Arguments after the script name
 * @returns The parsed options
 * @throws {HelpRequested} When `--help` / `-h` is present
 * @throws {Error} On an unknown flag or an unrecognised role
 */
function parseArgs(argv: string[]): CliOptions {
  const roles = new Set<SeedableRole>();
  let clean = false;
  let dryRun = false;
  let iKnowWhatImDoing = false;

  for (const arg of argv) {
    if (arg === "--") {
      // `pnpm run <script> -- --flag` forwards the separator itself; ignore it.
      continue;
    } else if (arg === "-h" || arg === "--help") {
      throw new HelpRequested();
    } else if (arg === "--clean") {
      clean = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--i-know-what-im-doing") {
      iKnowWhatImDoing = true;
    } else if (arg.startsWith("--role=")) {
      for (const raw of arg.slice("--role=".length).split(",")) {
        const role = raw.trim().toUpperCase();
        if (!isSeedableRole(role)) {
          throw new Error(
            `Unknown role "${raw.trim()}". Expected one of: ${SEEDABLE_ROLES.join(
              ", "
            )}`
          );
        }
        roles.add(role);
      }
    } else {
      throw new Error(`Unknown argument "${arg}"`);
    }
  }

  return {
    roles: roles.size > 0 ? [...roles] : ["SELF_SERVICE"],
    clean,
    dryRun,
    iKnowWhatImDoing,
  };
}

/**
 * Builds a Supabase admin client from the environment.
 *
 * Reads `process.env` directly rather than importing `~/utils/env`, which pulls
 * in Remix-adjacent modules that do not load in a plain Node script.
 *
 * @returns A service-role Supabase client
 * @throws {Error} When either required variable is missing
 */
function getSupabaseAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE;

  if (!url || !serviceRole) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set. Run this through " +
        "`pnpm seed:e2e`, which loads the monorepo-root .env via dotenv-cli."
    );
  }

  // why: no session persistence or token auto-refresh in a one-shot script —
  // this is the same configuration `app/integrations/supabase/client.ts` uses
  // server-side, and it keeps the process from hanging on a refresh timer.
  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** How many auth users to request per `listUsers` page when searching by email. */
const AUTH_LIST_PAGE_SIZE = 200;

/** Hard cap on pages scanned, so a large project can't spin forever. */
const AUTH_LIST_MAX_PAGES = 50;

/**
 * Finds a Supabase Auth user by email.
 *
 * The admin API has no "get by email", so this pages through `listUsers`. It is
 * only reached on a re-run (the create call is attempted first), so the scan
 * cost is paid at most once per role per run.
 *
 * @param supabase - Service-role client
 * @param email - Address to look for (compared case-insensitively)
 * @returns The auth user's id, or null when not found
 */
async function findAuthUserIdByEmail(
  supabase: SupabaseClient,
  email: string
): Promise<string | null> {
  const wanted = email.toLowerCase();

  for (let page = 1; page <= AUTH_LIST_MAX_PAGES; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: AUTH_LIST_PAGE_SIZE,
    });

    if (error) {
      throw new Error(`Failed to list Supabase auth users: ${error.message}`);
    }

    const match = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (match) {
      return match.id;
    }

    if (data.users.length < AUTH_LIST_PAGE_SIZE) {
      return null;
    }
  }

  throw new Error(
    `Scanned ${AUTH_LIST_MAX_PAGES} pages of Supabase auth users without ` +
      `finding ${email}. Refusing to keep paging.`
  );
}

/**
 * Ensures a confirmed Supabase Auth user exists for `email`.
 *
 * No password is set: the session is minted with the admin
 * `generateLink` → `verifyOtp` pattern (see `test/e2e/auth.setup.ts`), so a
 * credential would be an extra secret to store for no benefit.
 *
 * @param supabase - Service-role client
 * @param email - Address of the account
 * @returns `{ userId, created }` — `created` is false when it already existed
 */
async function ensureAuthUser(
  supabase: SupabaseClient,
  email: string
): Promise<{ userId: string; created: boolean }> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    // Skips the confirmation email entirely — nothing is ever delivered to a
    // `.test` address anyway, and an unconfirmed user cannot be issued a session.
    email_confirm: true,
    user_metadata: { seededBy: "seed-e2e-accounts" },
  });

  if (!error && data.user) {
    return { userId: data.user.id, created: true };
  }

  const existingId = await findAuthUserIdByEmail(supabase, email);
  if (existingId) {
    return { userId: existingId, created: false };
  }

  throw new Error(
    `Failed to create Supabase auth user ${email}: ${
      error?.message ?? "unknown error"
    }`
  );
}

/**
 * Ensures the Prisma `User` row for a seeded account exists and matches its
 * Supabase Auth id.
 *
 * `User.id` **is** the Supabase auth uid throughout this codebase (see
 * `createUser` in `app/modules/user/service.server.ts`), so a mismatch means a
 * previous auth user was deleted and recreated. That is reported rather than
 * repaired: silently deleting a user row is exactly the kind of destructive
 * guess this script must not make.
 *
 * @param db - Prisma client
 * @param account - The account definition
 * @param userId - The Supabase auth uid
 * @throws {Error} When a row with this email exists under a different id
 */
async function ensurePrismaUser(
  db: ExtendedPrismaClient,
  account: E2EAccount,
  userId: string
): Promise<void> {
  const existing = await db.user.findUnique({
    where: { email: account.email },
    select: { id: true },
  });

  if (existing && existing.id !== userId) {
    throw new Error(
      `Prisma User ${account.email} exists with id ${existing.id}, but the ` +
        `Supabase auth user is ${userId}. The two are out of sync. Run ` +
        "`pnpm clean:e2e` and seed again."
    );
  }

  if (existing) {
    return;
  }

  await db.user.create({
    data: {
      id: userId,
      email: account.email,
      username: account.username,
      firstName: account.firstName,
      lastName: account.lastName,
      // Skips the /welcome onboarding redirect in `_layout+/_layout.tsx`, which
      // would otherwise bounce every authenticated spec away from its target.
      onboarded: true,
      roles: {
        connectOrCreate: {
          where: { name: "USER" },
          create: { name: "USER" },
        },
      },
    },
  });
}

/**
 * Ensures the dedicated test organisation exists, owned by the OWNER account.
 *
 * Deliberately does **not** update an existing row beyond its name: if someone
 * has changed a setting on the test workspace, that is their business.
 *
 * @param db - Prisma client
 * @param ownerUserId - Prisma id of the OWNER account
 */
async function ensureOrganization(
  db: ExtendedPrismaClient,
  ownerUserId: string
): Promise<void> {
  await db.organization.upsert({
    where: { id: E2E_ORGANIZATION_ID },
    update: { name: E2E_ORGANIZATION_NAME },
    create: {
      id: E2E_ORGANIZATION_ID,
      name: E2E_ORGANIZATION_NAME,
      type: "TEAM",
      userId: ownerUserId,
      // Suppresses `SequentialIdMigrationModal`, which would otherwise cover
      // the app shell on first load and break any spec that clicks through it.
      hasSequentialIdsMigrated: true,
    },
  });
}

/**
 * Ensures the membership and team-member rows that make a user usable inside
 * the test workspace.
 *
 * The membership's `roles` is **set**, not pushed: re-running with a different
 * role for the same account must not leave the account holding both.
 *
 * @param db - Prisma client
 * @param account - The account definition
 * @param userId - Prisma/Supabase user id
 */
async function ensureMembership(
  db: ExtendedPrismaClient,
  account: E2EAccount,
  userId: string
): Promise<void> {
  await db.userOrganization.upsert({
    where: {
      userId_organizationId: {
        userId,
        organizationId: E2E_ORGANIZATION_ID,
      },
    },
    update: { roles: { set: [account.role] } },
    create: {
      userId,
      organizationId: E2E_ORGANIZATION_ID,
      roles: [account.role],
    },
  });

  // TeamMember has no unique constraint on (organizationId, userId), so this is
  // a find-then-create rather than an upsert.
  const existingTeamMember = await db.teamMember.findFirst({
    where: { organizationId: E2E_ORGANIZATION_ID, userId },
    select: { id: true },
  });

  if (!existingTeamMember) {
    await db.teamMember.create({
      data: {
        name: account.teamMemberName,
        organizationId: E2E_ORGANIZATION_ID,
        userId,
      },
    });
  }
}

/**
 * Seeds every requested role.
 *
 * OWNER is always included: `Organization.owner` is a required relation, so the
 * workspace cannot exist without it. See the module docs in
 * `test/e2e/accounts.ts` for why the least-privileged account is not made owner.
 *
 * @param db - Prisma client
 * @param supabase - Service-role Supabase client
 * @param requestedRoles - Roles asked for on the command line
 */
async function seed(
  db: ExtendedPrismaClient,
  supabase: SupabaseClient,
  requestedRoles: SeedableRole[]
): Promise<void> {
  const roles: SeedableRole[] = [
    "OWNER",
    ...requestedRoles.filter((r) => r !== "OWNER"),
  ];

  const userIdByRole = new Map<SeedableRole, string>();

  for (const role of roles) {
    const account = E2E_ACCOUNTS[role];
    const { userId, created } = await ensureAuthUser(supabase, account.email);
    userIdByRole.set(role, userId);
    await ensurePrismaUser(db, account, userId);
    console.log(
      `  ${role.padEnd(13)} ${account.email} — auth user ${
        created ? "created" : "already existed"
      }`
    );
  }

  // The org must exist before any membership can reference it.
  await ensureOrganization(db, userIdByRole.get("OWNER")!);
  console.log(
    `\n  Workspace "${E2E_ORGANIZATION_NAME}" (${E2E_ORGANIZATION_ID}) ready`
  );

  for (const role of roles) {
    await ensureMembership(db, E2E_ACCOUNTS[role], userIdByRole.get(role)!);
    console.log(`  ${role.padEnd(13)} joined the workspace`);
  }
}

/**
 * Removes everything this script creates, and nothing else.
 *
 * Scope is exact: the fixed organisation id, then the four known email
 * addresses. Deleting the organisation cascades its `UserOrganization` and
 * `TeamMember` rows; deleting a `User` cascades any organisation it owns.
 *
 * @param db - Prisma client
 * @param supabase - Service-role Supabase client
 */
async function clean(
  db: ExtendedPrismaClient,
  supabase: SupabaseClient
): Promise<void> {
  const org = await db.organization.findUnique({
    where: { id: E2E_ORGANIZATION_ID },
    select: { id: true, name: true },
  });

  if (org) {
    // Guard against ever deleting a workspace that isn't ours, even if the id
    // somehow collided with a real one.
    if (org.name !== E2E_ORGANIZATION_NAME) {
      throw new Error(
        `Organization ${E2E_ORGANIZATION_ID} is named "${org.name}", not ` +
          `"${E2E_ORGANIZATION_NAME}". Refusing to delete it.`
      );
    }
    await db.organization.delete({ where: { id: E2E_ORGANIZATION_ID } });
    console.log(`  Deleted workspace ${E2E_ORGANIZATION_ID}`);
  } else {
    console.log(`  Workspace ${E2E_ORGANIZATION_ID} not present`);
  }

  for (const role of SEEDABLE_ROLES) {
    const { email } = E2E_ACCOUNTS[role];

    const user = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (user) {
      await db.user.delete({ where: { id: user.id } });
      console.log(`  Deleted Prisma user ${email}`);
    }

    const authUserId =
      user?.id ?? (await findAuthUserIdByEmail(supabase, email));

    if (authUserId) {
      const { error } = await supabase.auth.admin.deleteUser(authUserId);
      if (error) {
        // Not fatal: the Prisma side is already gone, and a leftover auth user
        // is re-used on the next seed. Report it so it isn't a silent no-op.
        console.warn(
          `  WARNING: could not delete Supabase auth user ${email}: ${error.message}`
        );
      } else {
        console.log(`  Deleted Supabase auth user ${email}`);
      }
    }
  }
}

/** Entry point — parses args, runs the requested mode, handles lifecycle. */
async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof HelpRequested) {
      console.log(USAGE);
      process.exit(0);
    }
    console.error(
      `\nError: ${err instanceof Error ? err.message : String(err)}`
    );
    console.error(USAGE);
    process.exit(1);
  }

  if (process.env.NODE_ENV === "production" && !options.iKnowWhatImDoing) {
    console.error(
      "\nRefusing to run with NODE_ENV=production without --i-know-what-im-doing.\n"
    );
    process.exit(2);
  }

  const mode = options.clean ? "CLEAN" : "SEED";
  console.log(`\n=== E2E account seeder — ${mode} ===\n`);

  if (options.dryRun) {
    const roles = options.clean
      ? SEEDABLE_ROLES
      : ["OWNER", ...options.roles.filter((r) => r !== "OWNER")];
    console.log("--dry-run: nothing will be written.\n");
    console.log(`Workspace: ${E2E_ORGANIZATION_NAME} (${E2E_ORGANIZATION_ID})`);
    console.log("Accounts:");
    for (const role of roles as SeedableRole[]) {
      console.log(`  ${role.padEnd(13)} ${E2E_ACCOUNTS[role].email}`);
    }
    console.log("");
    return;
  }

  const supabase = getSupabaseAdminClient();
  const db = createDatabaseClient();

  try {
    await db.$connect();
    if (options.clean) {
      await clean(db, supabase);
    } else {
      await seed(db, supabase, options.roles);
    }
    console.log("\nDone.\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
