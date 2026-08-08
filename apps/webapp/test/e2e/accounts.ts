/**
 * Seeded end-to-end test accounts — the single source of truth.
 *
 * Both the seeder (`scripts/seed-e2e-accounts.ts`) and the Playwright auth
 * setup (`test/e2e/auth.setup.ts`) import from here, so an email or an
 * organisation id can never drift between "what was created" and "what the
 * tests sign in as".
 *
 * ## Why these values look the way they do
 *
 * The seeder writes to whichever Supabase project `.env` points at — on this
 * machine that is Neil's real project, because it is the only one configured.
 * Every identifier below is therefore deliberately *unmistakably synthetic*:
 *
 * - The email domain is `.test`, a TLD permanently reserved by RFC 6761 for
 *   testing. It can never resolve and can never be a real volunteer.
 * - The organisation name is prefixed `[E2E]` so it is obvious in the workspace
 *   switcher and in any admin listing.
 * - The organisation id is a **fixed, non-cuid string**. `Organization.id` is a
 *   plain `String @id`, so pinning it makes seeding idempotent (upsert by id)
 *   and makes cleanup exact — the cleanup path never has to guess which rows
 *   are ours.
 *
 * ## The organisation owner
 *
 * `Organization.owner` is a required relation, so the workspace needs an owner
 * user regardless of which role is under test. Rather than making the
 * least-privileged user own the workspace it is a member of (which no real
 * `SELF_SERVICE` volunteer ever is, and which would make the fixture lie about
 * the situation it is meant to reproduce), the seeder always creates the
 * dedicated OWNER account below and attaches every other role alongside it.
 *
 * Role resolution is read purely from `UserOrganization.roles` — see
 * `resolveEffectiveRole` in `app/utils/roles.server.ts` — so ownership of the
 * `Organization` row grants nothing by itself.
 *
 * @see {@link file://./auth.setup.ts} — mints the session cookie
 * @see {@link file://./../../scripts/seed-e2e-accounts.ts} — creates/removes these rows
 */

import type { OrganizationRoles } from "@prisma/client";

/**
 * RFC 6761 reserved TLD. Guaranteed never to resolve, so a seeded account can
 * never be confused with (or accidentally email) a real person.
 */
export const E2E_EMAIL_DOMAIN = "hcf-production-stock.test";

/**
 * Fixed id for the dedicated test workspace. Pinned rather than generated so
 * both seeding and cleanup are exact and idempotent.
 */
export const E2E_ORGANIZATION_ID = "e2e-hcf-test-org";

/** Workspace name, prefixed so it is obvious in any UI listing. */
export const E2E_ORGANIZATION_NAME = "[E2E] HCF Automated Test Workspace";

/** The org roles this fixture knows how to seed. */
export type SeedableRole = Extract<
  OrganizationRoles,
  "OWNER" | "ADMIN" | "BASE" | "SELF_SERVICE"
>;

/** A single seeded account. */
export type E2EAccount = {
  /** Org role granted via `UserOrganization.roles`. */
  role: SeedableRole;
  /** Login identity; also the Supabase Auth user's email. */
  email: string;
  /** `User.username` — unique across the instance, so it carries the prefix. */
  username: string;
  firstName: string;
  lastName: string;
  /** `TeamMember.name` shown in custody / booking pickers. */
  teamMemberName: string;
};

/**
 * Every account this fixture can seed, keyed by role.
 *
 * Only `SELF_SERVICE` is wired into a Playwright project today (it is the
 * least-privileged role and the one QA could not otherwise reach). The other
 * three are defined so a future spec needs a seeder flag, not a code change.
 */
export const E2E_ACCOUNTS: Record<SeedableRole, E2EAccount> = {
  OWNER: {
    role: "OWNER",
    email: `e2e-owner@${E2E_EMAIL_DOMAIN}`,
    username: "e2e-owner",
    firstName: "E2E",
    lastName: "Owner",
    teamMemberName: "E2E Owner",
  },
  ADMIN: {
    role: "ADMIN",
    email: `e2e-admin@${E2E_EMAIL_DOMAIN}`,
    username: "e2e-admin",
    firstName: "E2E",
    lastName: "Admin",
    teamMemberName: "E2E Admin",
  },
  BASE: {
    role: "BASE",
    email: `e2e-base@${E2E_EMAIL_DOMAIN}`,
    username: "e2e-base",
    firstName: "E2E",
    lastName: "Base",
    teamMemberName: "E2E Base",
  },
  SELF_SERVICE: {
    role: "SELF_SERVICE",
    email: `e2e-selfservice@${E2E_EMAIL_DOMAIN}`,
    username: "e2e-selfservice",
    firstName: "E2E",
    lastName: "Self Service",
    teamMemberName: "E2E Self Service",
  },
};

/** Every seedable role, in a stable order (OWNER first — it owns the org). */
export const SEEDABLE_ROLES: SeedableRole[] = [
  "OWNER",
  "ADMIN",
  "BASE",
  "SELF_SERVICE",
];

/**
 * Narrows an arbitrary string to a {@link SeedableRole}.
 *
 * @param value - Candidate role name (e.g. from a CLI flag)
 * @returns true when `value` is a role this fixture can seed
 */
export function isSeedableRole(value: string): value is SeedableRole {
  return (SEEDABLE_ROLES as string[]).includes(value);
}

/**
 * Path to the Playwright `storageState` file for a role.
 *
 * Deliberately **relative to `apps/webapp`** — Playwright resolves
 * `storageState` paths against the process CWD, and every entry point for
 * these tests (`pnpm --filter @shelf/webapp test:e2e`, `pnpm webapp:test:e2e`)
 * runs there. The whole `.auth/` directory is git-ignored: these files contain
 * a live session cookie and must never be committed.
 *
 * @param role - The seeded role whose session to load
 * @returns Relative path to the storage-state JSON
 */
export function storageStatePath(role: SeedableRole): string {
  return `test/e2e/.auth/${role.toLowerCase()}.json`;
}
