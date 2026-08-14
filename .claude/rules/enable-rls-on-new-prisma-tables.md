# Every New Table Needs `ENABLE ROW LEVEL SECURITY` In Its Migration

Prisma does not emit it. Supabase does not add it. Nothing in CI checks for it.
A table created by `prisma migrate` is **publicly readable and writable** the
moment it reaches production.

## Why the default is open, not closed

Two facts combine into a hole:

1. **`pg_default_acl` grants `anon` and `authenticated` full DML (`arwdDxtm`)**
   on every new table `postgres` creates in `public`. Prisma's table inherits
   those grants automatically.
2. **RLS is not inherited.** It is per-table state and defaults to `disabled`.

All 68 existing tables in this database have RLS **enabled with zero policies**.
That combination — enabled, no policies — denies everything through PostgREST
while Prisma (the table owner) bypasses RLS entirely and keeps working. **That is
the only thing keeping Supabase's auto-generated REST API off the data.** It is
not defence in depth; it is the single control.

Miss it on one table and that table alone is exposed at
`/rest/v1/<TableName>` to anyone holding `SUPABASE_ANON_PUBLIC` — **a public
value that ships in the browser bundle**. For `AssetRepair` that would have meant,
with no login at all: read every fault report in every organization (cross-tenant
disclosure straight past org-scoping), insert an open repair against any asset in
any workspace (a denial-of-service on booking, since an open repair blocks it),
and delete repairs to return written-off gear to the bookable pool.

**Nothing would have caught it.** Typecheck and tests pass — this is not
expressible in `schema.prisma`. `shelf-security-reviewer` excludes migrations.
Code review reads the Prisma model, not the generated SQL. It reaches production
or it is caught by a human reading `migration.sql`.

```sql
-- ❌ Bad — what `prisma migrate` generates, and it is publicly writable
CREATE TABLE "AssetRepair" ( ... );
CREATE INDEX ...;
ALTER TABLE "AssetRepair" ADD CONSTRAINT ... FOREIGN KEY ...;

-- ✅ Good — add this as the last statement, by hand, in the same migration
ALTER TABLE "AssetRepair" ENABLE ROW LEVEL SECURITY;
```

Add **no policies** unless the table is genuinely meant to be reachable from the
client. Enabled-with-no-policies is the established pattern here; a policy is how
you deliberately open a door.

## Checklist for any migration that creates a table

- [ ] `ENABLE ROW LEVEL SECURITY` on **every** new table, in the **same**
      migration — not a follow-up, or there is a live window in between.
- [ ] Do **not** set `FORCE ROW LEVEL SECURITY` — the owner must keep bypassing
      it, or Prisma's own queries start failing.
- [ ] Partial unique indexes and other constraints Prisma cannot express go in
      the same file, hand-written, with a comment saying why.
- [ ] **Never run `prisma format` in this repo** — it reformats `schema.prisma`
      wholesale (196 insertions of pure churn across unrelated models, measured).
      Use `prisma validate`.
- [ ] Verify offline with
      `prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel <new> --script`
      and diff it against what you wrote. Statements Prisma cannot infer should
      be exactly your deliberate additions — nothing more, nothing missing.

⚠️ **There is no local database in this checkout.** The root `.env` points at the
**live** Supabase project. `prisma migrate deploy`, `migrate dev`, `db push` and
`migrate reset` all hit production data. Verification is offline or it does not
happen.

Found on `AssetRepair` (equipment-repairs, 2026-08-09) before it shipped, by a
specialist reading the generated SQL rather than trusting the model. It was luck
that anyone looked.
