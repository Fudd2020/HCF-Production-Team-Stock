-- Equipment repairs — reinstate a written-off asset (US-012).
--
-- EXPAND-ONLY. Purely additive: one new enum VALUE, three new nullable columns
-- and one foreign key. **No existing column changes shape**, nothing is dropped
-- or narrowed, and there is NO backfill. Old application code that knows
-- nothing of these columns keeps working, which is what makes it safe to apply
-- BEFORE the code that reads them — the ordering this project requires
-- (`DECISIONS.md` #230, and the deploy-ordering constraint #94 that preceded it).
--
-- This is the feature's THIRD migration. `DECISIONS.md` #33 approved US-001's
-- table only and #249 approved US-008's lifecycle columns; #59 records that
-- this one needs Neil's explicit approval on its own.
--
-- ## Why there is no backfill
--
-- `reinstatedAt` stays NULL on every existing row, which is exactly right:
-- nothing has ever been reinstated, because until this story there was no way
-- to do it. A NULL here is not missing data — it is the true statement that
-- this repair was never brought back.
--
-- ⚠️ **Do NOT be tempted to backfill `reinstatedAt` from `closedAt`.** They mean
-- opposite things. An ordinary repair has `closedAt` set because it was FIXED
-- (US-005); a reinstated one has `closedAt` set because a lead overturned a
-- write-off (#46). Copying one into the other would relabel every genuine
-- repair in the workspace as "written off, then reinstated".
--
-- ## The one thing to understand before reading the columns
--
-- Reinstating STAMPS `closedAt` and NEVER clears `outcome` (#46, #47). It has
-- to stamp it: bookability is `closedAt IS NULL` and may never gain a second
-- input (#31, permanent), so that is the only lever that returns an asset to
-- the pool. The row therefore ends up reading "written off by X on D1,
-- reinstated by Y on D2" — permanently, because fault records are append-only
-- (US-012 AC3, US-004 AC5/AC8).
--
-- The consequence for every reader: `closedAt IS NOT NULL` no longer implies
-- "this was repaired". Branch `outcome` → `reinstatedAt` → `closedAt`, in that
-- order (#51). `resolveRepairHistoryState` is the one place that does.
--
-- ## How this file was generated, and why that matters
--
-- With `prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel
-- <new> --script`, NOT `prisma migrate dev --create-only`.
--
-- `DECISIONS.md` #220 records that `migrate dev --create-only` emits FOUR
-- destructive statements in this repo on every run — two FK drops and two
-- Location trigram index drops — because those objects exist in the database
-- but are not expressible in `schema.prisma`, so Prisma reads them as drift and
-- "corrects" them. `migrate diff` between two SCHEMA FILES never sees the
-- database, so it cannot invent that. Verified: the generated output was
-- exactly the four statements below and nothing else.

-- 1. The activity action. Its OWN value, never `ASSET_REPAIR_CLOSED` with a
--    flag (#46's audit-trail note, `.claude/rules/record-event-payload-shapes.md`).
--    A reinstate stamps the same `closedAt` an ordinary close does, so without
--    a distinct action the two are indistinguishable in every report and
--    "how much written-off gear did we bring back?" becomes a JSON parse.
--
--    `ALTER TYPE ... ADD VALUE` is not reversible in PostgreSQL. Accepted:
--    `ActivityAction` is additive-only by design, because existing
--    `ActivityEvent` rows hold the old strings.
ALTER TYPE "ActivityAction" ADD VALUE 'ASSET_REPAIR_REINSTATED';

-- 2. The columns.
--
--    All three are nullable and stay NULL together — `reinstatedAt` is set ONLY
--    alongside an existing `outcome = 'WRITTEN_OFF'`, enforced by the service's
--    compare-and-set (#49), whose WHERE clause is mutually exclusive with
--    US-005's close by construction.
--
--    These exist INSTEAD OF reusing `closedById` / `closerSnapshot`, which stay
--    NULL on a reinstated repair (#48). That row was never repaired, and
--    putting the reinstater in `closedBy` would render as "this person repaired
--    it" — the identical lie #108 refused to tell about whoever wrote it off.
--
--    `reinstaterSnapshot` mirrors `reporterSnapshot` / `outcomeActorSnapshot`:
--    the FK below is SET NULL, so the name is captured at write time or the
--    history renders anonymously once that user is deleted.
ALTER TABLE "AssetRepair" ADD COLUMN     "reinstatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "reinstatedById" TEXT,
ADD COLUMN     "reinstaterSnapshot" JSONB;

-- 3. The actor FK. SET NULL, matching `reportedById` / `closedById` /
--    `outcomeById`: deleting a person must never delete the equipment's
--    history, which is why the snapshot column above exists.
ALTER TABLE "AssetRepair" ADD CONSTRAINT "AssetRepair_reinstatedById_fkey" FOREIGN KEY ("reinstatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. NO new index, deliberately.
--    #52 records that `/repairs`' buckets are all `closedAt IS NULL`, so a
--    reinstated repair leaves the "written off" bucket the instant it is
--    stamped — served by the existing `AssetRepair(organizationId, closedAt,
--    reportedAt)` and `AssetRepair(assetId, closedAt)` indexes. Nothing queries
--    on `reinstatedAt`; it is rendered, not filtered.

-- 5. NO `ENABLE ROW LEVEL SECURITY` statement here, deliberately.
--    `.claude/rules/enable-rls-on-new-prisma-tables.md` requires it for every
--    NEW TABLE. This migration creates no table — `AssetRepair` already has RLS
--    enabled with zero policies (verified in production on 2026-08-14, #230),
--    and that protection covers these columns automatically. Re-enabling it
--    would be a no-op; the rule is recorded here so the next reader can see it
--    was considered rather than forgotten.

-- 6. The partial unique index `AssetRepair_assetId_open_key` is UNTOUCHED, and
--    that is what makes US-012 AC5 free. It covers `closedAt IS NULL` rows
--    only, so stamping `closedAt` releases it and a new fault becomes
--    reportable against the reinstated asset with no code at all (#52).
