-- Adds the two `ActivityAction` values the repairs feature needs, so the
-- structured audit trail can be written alongside the system note.
--
-- `ActivityAction` is ADDITIVE-ONLY: a value may be added but never renamed or
-- removed, because existing `ActivityEvent` rows hold the old string.
--
-- US-012's reinstate will need `ASSET_REPAIR_REINSTATED`. It is deliberately
-- NOT added here: an unused enum value invites someone to guess at its
-- semantics before the story that defines them exists.

ALTER TYPE "ActivityAction" ADD VALUE 'ASSET_REPAIR_REPORTED';
ALTER TYPE "ActivityAction" ADD VALUE 'ASSET_REPAIR_CLOSED';

-- ⚠️ FOUR DESTRUCTIVE STATEMENTS WERE REMOVED FROM THIS FILE BY HAND.
--
-- `prisma migrate dev --create-only` generated the two ALTER TYPEs above AND
-- the following, none of which relate to this change:
--
--   ALTER TABLE "BookingAsset"   DROP CONSTRAINT "BookingAsset_assetKitId_fkey";
--   ALTER TABLE "ConsumptionLog" DROP CONSTRAINT "ConsumptionLog_bookingAssetId_fkey";
--   DROP INDEX "Location_address_trgm_idx";
--   DROP INDEX "Location_description_trgm_idx";
--
-- These four objects exist in the database but are NOT expressible in
-- `schema.prisma` — they were created by raw SQL in earlier migrations (the
-- trigram indexes) or carry definitions Prisma's introspection does not model.
-- Prisma therefore reads them as drift and "corrects" it by dropping them.
--
-- Shipping them would have dropped two foreign keys and two search indexes in
-- production, silently, inside a migration whose stated purpose was to add two
-- enum values.
--
-- **Every future `migrate dev --create-only` in this repo will regenerate these
-- same four statements.** Read the generated SQL before keeping it; do not
-- assume a migration contains only what you asked for.
