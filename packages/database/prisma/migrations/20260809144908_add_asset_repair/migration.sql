-- Equipment repairs — the `AssetRepair` table (US-001).
--
-- EXPAND-ONLY. This migration is purely additive: one new table, its indexes
-- and its foreign keys. **No existing table changes shape**, no column is
-- dropped, narrowed or made NOT NULL, and there is NO backfill. Old application
-- code that knows nothing about `AssetRepair` keeps working untouched, which is
-- what makes this safe to apply during the bluegreen window where old and new
-- machines serve traffic simultaneously.
--
-- Contract this table encodes:
--   * A repair is OPEN while `closedAt IS NULL`. That single predicate is the
--     WHOLE bookability rule. Nothing else may ever become a second input to
--     the booking guard.
--   * There is no quantity dimension. One repair = one Asset. "How many are
--     available" is derived by counting assets with no open repair.
--   * Lifecycle columns (`status`, `diagnosis`, `outcome`) are deliberately NOT
--     created here; they arrive later in their own additive migration.
--
-- No backfill is required. Verified before writing this: zero assets carry the
-- day-one `availableToBook = false` workaround, so there is nothing to migrate
-- into repair records.

-- 1. The table.
--
--    All datetimes are `TIMESTAMPTZ(3)` — these are operational timestamps read
--    across time zones ("out of action for N days"), so a naive timestamp would
--    drift by the server's offset.
--
--    `reporterSnapshot` / `closerSnapshot` exist because both user FKs below are
--    `ON DELETE SET NULL`: deleting a user must not delete the fault history,
--    but it does null the id, so the name is captured at write time instead.
--    Mirrors `ActivityEvent.actorSnapshot`. Shape: { firstName, lastName,
--    displayName }.
CREATE TABLE "AssetRepair" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "faultDescription" TEXT NOT NULL,
    "reportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedById" TEXT,
    "reporterSnapshot" JSONB,
    "closedAt" TIMESTAMPTZ(3),
    "closedById" TEXT,
    "closerSnapshot" JSONB,
    "resolutionNote" TEXT,

    CONSTRAINT "AssetRepair_pkey" PRIMARY KEY ("id")
);

-- 2. Indexes.
--
--    Both are created on an EMPTY table, so neither needs CONCURRENTLY and
--    neither blocks anything — there are no rows to scan.
--
--    a) The workspace "out of action" list: filter by org, split open from
--       closed, order by report date. Column order matches that access path so
--       Postgres can seek the org and read the page straight off the index.
--    b) Per-asset fault history, and — more importantly — the booking guard's
--       hot path: `WHERE "assetId" IN (…) AND "closedAt" IS NULL`. This runs on
--       every booking create, reserve, check-out and scan-to-booking, so it is
--       the one index the feature cannot do without.
--
--    No index on `reportedById` / `closedById`. They are only read on the
--    `ON DELETE SET NULL` path (deleting a user), which is rare and touches a
--    table of at most a few hundred rows. Indexes cost write throughput; these
--    two would not pay for themselves.
CREATE INDEX "AssetRepair_organizationId_closedAt_reportedAt_idx" ON "AssetRepair"("organizationId", "closedAt", "reportedAt");

CREATE INDEX "AssetRepair_assetId_closedAt_idx" ON "AssetRepair"("assetId", "closedAt");

-- 3. Foreign keys.
--
--    `Asset` and `Organization` cascade: deleting either must not leave a repair
--    row pointing at nothing (an orphan would show as a broken row on the
--    repairs list). `User` is SET NULL instead — deleting a person must never
--    delete the equipment's fault history; see the snapshot columns above.
--
--    Each of these briefly takes a SHARE ROW EXCLUSIVE lock on the REFERENCED
--    table (Asset / Organization / User). Because "AssetRepair" is empty there
--    is no validation scan, so the lock is momentary rather than proportional
--    to the size of those tables.
ALTER TABLE "AssetRepair" ADD CONSTRAINT "AssetRepair_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssetRepair" ADD CONSTRAINT "AssetRepair_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssetRepair" ADD CONSTRAINT "AssetRepair_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssetRepair" ADD CONSTRAINT "AssetRepair_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. ONE OPEN REPAIR PER ASSET — a partial unique index.
--
--    This is load-bearing, not a nicety. Two people reporting the same fault in
--    the same second must not both succeed: an application pre-read cannot
--    promise that (both reads see "no open repair", both insert), a unique index
--    can. One transaction commits, the other gets `P2002`, and the service
--    translates that into a 400 pointing at the repair that already exists.
--
--    Prisma cannot express a WHERE clause on `@@unique`, so this lives in
--    migration SQL only and is INVISIBLE to `schema.prisma`. In-repo precedent:
--    `BookingAsset_manual_unique` / `BookingAsset_kit_unique` in
--    `20260525131507_bookingasset_kit_discriminator`. A comment on the model
--    points here; do not "clean up" an index you cannot find in the schema.
--
--    Note the deliberate consequence: because a written-off repair is never
--    closed (`closedAt` stays NULL for ever, with the outcome recording why),
--    this index permanently refuses any further fault report against a
--    written-off asset. That is intended, not a limitation — reporting a new
--    fault on scrapped gear is nonsense, and the index enforces "written off
--    means permanently out of the pool" for free on the report path as well as
--    the booking path. It relaxes by itself if the repair is ever closed.
--
--    Safe to create against existing data: the table was created empty three
--    statements ago, so there is nothing that could violate it.
CREATE UNIQUE INDEX "AssetRepair_assetId_open_key"
  ON "AssetRepair" ("assetId")
  WHERE "closedAt" IS NULL;

-- 5. Row Level Security.
--
--    REQUIRED — do not remove. Every one of the other tables in this schema has
--    RLS enabled with zero policies, and that is the only thing keeping
--    Supabase's auto-generated PostgREST API away from the data: `pg_default_acl`
--    grants `anon` and `authenticated` full DML on every new table created in
--    `public`, and the anon key is a PUBLIC value that ships in the browser
--    bundle. Prisma creates the table with those grants but WITHOUT RLS, so
--    omitting this line would leave `AssetRepair` the single unprotected table
--    in the database — cross-tenant readable, and writable by anyone: inserting
--    an open repair against another workspace's asset takes their gear out of
--    service, deleting one puts faulty gear back in the pool.
--
--    No policies, deliberately: that matches the sibling tables exactly. The
--    application is unaffected because Prisma connects as the table OWNER, and
--    the owner bypasses RLS unless FORCE ROW LEVEL SECURITY is set (it is not,
--    here or on any sibling table). Precedent:
--    `20260616081650_enable_rls_for_mobile_auth_code`.
ALTER TABLE "AssetRepair" ENABLE ROW LEVEL SECURITY;
