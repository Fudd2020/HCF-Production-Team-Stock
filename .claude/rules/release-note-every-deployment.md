# Every Deployment Ships a Release Note

Users find out what changed from the in-app **Updates** feed (`/updates`) and
nowhere else. There is no email, no blog, no changelog page. If a deployment
adds something a user can see or do and no note goes with it, the feature ships
silently and the people holding the gear never learn it exists.

The notes are **source-controlled data**, not something typed into the admin
dashboard after the fact:

| Where                                            | What                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `apps/webapp/scripts/release-notes/catalogue.ts` | The notes. Add an entry here, in the same PR as the feature                      |
| `pnpm webapp:release-notes:publish`              | Upserts them into the `Update` table. Idempotent — Neil runs it after the deploy |
| `.../publish.ts`, `catalogue.test.ts`            | Validation + the CI guard on id format, uniqueness and ordering                  |

## The rules

1. **One entry per deployment**, not per story. Ten stories that shipped
   together are one note with ten bullets — that is how a user experiences it.
2. **`id` is `release-<YYYY-MM-DD>-<feature-slug>` and is immutable.** It is the
   row's primary key, and `UserUpdateRead` hangs off it. Editing a published id
   orphans the note and everyone's read state; the date in it must match `date`.
3. **Write for the person using the app.** What they can now do — not which
   module changed, which story id it was, or how it was built.
4. **Publish is a deploy step, not a code step.** The catalogue landing on
   `main` changes nothing on its own; the note appears when the script runs.
5. **No note for invisible work.** Refactors, dependency bumps, internal fixes
   and test changes get nothing. A user-facing bug fix does get one.

```ts
// ❌ Bad — release-note prose written for the team that built it
{
  id: "updates-repairs",                     // no date, not immutable-looking
  title: "US-001..US-012 equipment-repairs", // story ids mean nothing to a user
  content: "Adds AssetRepair model, RLS policy and the repairs service module.",
}

// ✅ Good — dated, stable id, and it says what changed for the reader
{
  id: "release-2026-08-16-equipment-repairs",
  title: "Equipment repairs: report a fault, and stop broken gear going out",
  date: "2026-08-16",
  content: `Report a fault the moment you find it, and the gear stops being
bookable until somebody fixes it.

- **Report a fault on any asset.** You do not need to be an admin.
- **Faulty equipment cannot be booked**, so it cannot turn up at a service.`,
}
```

**Whoever writes the note is whoever ships the change** — `shelf-release-manager`
checks it exists as a readiness gate, and treats a missing one as GO WITH
CONDITIONS, never a silent pass.

⚠️ This fork has **no user holding the global `ADMIN` role**, so the
`/admin-dashboard` authoring UI is unreachable and the publish script's default
author lookup finds nobody. Set `RELEASE_NOTES_AUTHOR_EMAIL` in `.env`, or pass
`--author=<email>`.
