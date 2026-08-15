-- Equipment repairs — the lifecycle columns (US-008).
--
-- EXPAND-ONLY. Purely additive: two new enums, three new enum VALUES, five new
-- nullable-or-defaulted columns and one foreign key. **No existing column
-- changes shape**, nothing is dropped or narrowed, and there is NO backfill.
-- Old application code that knows nothing of these columns keeps working, which
-- is what makes it safe to apply BEFORE the code that reads them — the ordering
-- this project requires (`DECISIONS.md` #230, and the deploy-ordering
-- constraint #94 that preceded it).
--
-- ## Why there is no backfill (US-008 AC7)
--
--   * `status` takes its column DEFAULT, so every pre-existing open repair
--     lands in 'REPORTED' — the stage US-001 creates a repair in. Correct by
--     construction rather than by a data fix.
--   * `outcome` stays NULL on every existing row, so no historic repair can be
--     mistaken for written off. That matters: a non-null `outcome` is what makes
--     an asset PERMANENTLY unbookable (#36, #37), so a careless backfill here
--     would scrap real gear.
--   * "Fixed" is NOT a stored status. It is derived from a non-null `closedAt`,
--     which every repair US-005 already closed has. There is deliberately no
--     `FIXED` member in `RepairStatus` — see the schema comment.
--
-- ## How this file was generated, and why that matters
--
-- With `prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel
-- <new> --script`, NOT `prisma migrate dev --create-only`.
--
-- `DECISIONS.md` #220 records that `migrate dev --create-only` emits FOUR
-- destructive statements in this repo on every run — two FK drops and two
-- Location trigram index drops — because those objects exist in the database but
-- are not expressible in `schema.prisma`, so Prisma reads them as drift and
-- "corrects" them. `migrate diff` between two SCHEMA FILES never sees the
-- database, so it cannot invent that. This file was checked by eye regardless.

-- 1. The open stages. No FIXED member: fixed is derived from `closedAt`.
CREATE TYPE "RepairStatus" AS ENUM ('REPORTED', 'DIAGNOSED', 'IN_REPAIR');

-- 2. How a repair ended, when it ended in something other than a fix.
--    One member today; an enum rather than a boolean so a second answer does
--    not require renaming `isWrittenOff` across the codebase.
CREATE TYPE "RepairOutcome" AS ENUM ('WRITTEN_OFF');

-- 3. Activity actions — additive-only, and one value per LOGICAL change so
--    "how often does a repair stall at diagnosed?" stays a groupBy rather than
--    a JSON parse (`.claude/rules/record-event-payload-shapes.md`).
--
--    `ALTER TYPE ... ADD VALUE` is not reversible in PostgreSQL. That is
--    accepted: `ActivityAction` is additive-only by design, because existing
--    `ActivityEvent` rows hold the old strings.
ALTER TYPE "ActivityAction" ADD VALUE 'ASSET_REPAIR_STAGE_CHANGED';
ALTER TYPE "ActivityAction" ADD VALUE 'ASSET_REPAIR_DIAGNOSED';
ALTER TYPE "ActivityAction" ADD VALUE 'ASSET_REPAIR_WRITTEN_OFF';

-- 4. The columns.
--
--    `outcomeAt` / `outcomeById` / `outcomeActorSnapshot` exist INSTEAD OF
--    reusing `closedById` (`DECISIONS.md` #108). #48 already refused to record
--    the reinstater in `closedById` because "that row was never repaired, and
--    labelling the reinstater 'closed by' would make US-004's history lie". The
--    same argument applies to whoever wrote it off: once US-012's reinstate
--    stamps `closedAt`, anything in `closedBy` renders as "this person repaired
--    it". US-012 AC3 requires showing that it was written off, by whom and
--    when, which is unsatisfiable without these three.
--
--    `status` is NOT NULL with a default, so the table is not rewritten with a
--    long lock: PostgreSQL 11+ stores a non-volatile column default in the
--    catalogue rather than rewriting every row.
ALTER TABLE "AssetRepair" ADD COLUMN     "diagnosis" TEXT,
ADD COLUMN     "outcome" "RepairOutcome",
ADD COLUMN     "outcomeActorSnapshot" JSONB,
ADD COLUMN     "outcomeAt" TIMESTAMPTZ(3),
ADD COLUMN     "outcomeById" TEXT,
ADD COLUMN     "status" "RepairStatus" NOT NULL DEFAULT 'REPORTED';

-- 5. The actor FK. SET NULL, matching `reportedById` / `closedById`: deleting a
--    person must never delete the equipment's history, which is why the
--    snapshot column above exists.
ALTER TABLE "AssetRepair" ADD CONSTRAINT "AssetRepair_outcomeById_fkey" FOREIGN KEY ("outcomeById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. NO `ENABLE ROW LEVEL SECURITY` statement here, deliberately.
--    `.claude/rules/enable-rls-on-new-prisma-tables.md` requires it for every
--    NEW TABLE. This migration creates no table — `AssetRepair` already has RLS
--    enabled with zero policies (verified in production on 2026-08-14, #230),
--    and that protection covers these columns automatically. Re-enabling it
--    would be a no-op; the rule is recorded here so the next reader can see it
--    was considered rather than forgotten.
