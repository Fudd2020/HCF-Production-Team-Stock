/**
 * Publishes the release-notes catalogue into the in-app **Updates** feed.
 *
 * Reads `scripts/release-notes/catalogue.ts` and upserts one `Update` row per
 * entry, keyed on the note's stable `id`. `/updates` renders those rows, so
 * running this is what makes a release note visible to users.
 *
 * This file is the CLI wrapper only — the logic lives in
 * `scripts/release-notes/publish.ts`, so importing it never opens a database
 * connection as a side effect.
 *
 * ## Safety
 *
 * Deliberately conservative, because it writes to whichever database `.env`
 * points at — which on a developer machine is the real project:
 *
 * - **Idempotent.** Re-running upserts the same rows; nothing is duplicated.
 * - **It only ever touches rows it owns.** Every id is `release-*`, and there
 *   is no `delete` or `deleteMany` anywhere in this feature. An `Update`
 *   written by hand in the admin dashboard is never read, changed or removed.
 * - **View and click counts survive a re-publish**, so correcting a typo does
 *   not reset a note's analytics — and neither does anyone's read state.
 * - The catalogue is validated before anything is written.
 * - `--dry-run` prints the exact plan and writes nothing.
 *
 * ## Usage
 *
 * ```bash
 * # from the monorepo root
 * pnpm webapp:release-notes:publish              # publish to whatever .env points at
 * pnpm webapp:release-notes:publish -- --dry-run # print the plan, write nothing
 * pnpm webapp:release-notes:publish:staging      # publish to staging
 *
 * # from apps/webapp
 * pnpm release-notes:publish -- --draft          # write them as DRAFT, publish later
 * pnpm release-notes:publish -- --author=someone@example.com
 * ```
 *
 * ## Choosing the author
 *
 * `Update.createdById` is a required relation. Resolution order:
 * `--author=<email>`, then `RELEASE_NOTES_AUTHOR_EMAIL`, then the oldest user
 * holding the global ADMIN role.
 *
 * Design note: uses `createDatabaseClient()` directly rather than the webapp's
 * `app/database/db.server.ts` wrapper, which references browser globals and
 * does not work in a plain Node script — the same reason
 * `seed-e2e-accounts.ts` and `seed-reporting-demo.ts` do it this way.
 *
 * @see {@link file://./release-notes/catalogue.ts} — the notes themselves
 * @see {@link file://./release-notes/publish.ts} — the logic
 * @see {@link file://./../app/routes/_layout+/updates.tsx} — where they appear
 */

import { createDatabaseClient } from "@shelf/database";

import { RELEASE_NOTES } from "./release-notes/catalogue";
import type { PublishOptions } from "./release-notes/publish";
import {
  publishReleaseNotes,
  resolveAuthorId,
  validateCatalogue,
} from "./release-notes/publish";

const USAGE = `
Usage: tsx scripts/publish-release-notes.ts [options]

  --dry-run          Print what would be written; change nothing.
  --draft            Write the notes as DRAFT instead of PUBLISHED.
  --author=<email>   User to record as the notes' author.
  --help             Show this message.
`;

function parseArgs(argv: string[]): PublishOptions | "help" {
  const options: PublishOptions = { dryRun: false, draft: false };

  for (const arg of argv) {
    // pnpm forwards its own `--` separator through to us; ignore it so the
    // documented `pnpm ... -- --dry-run` form works.
    if (arg === "--") continue;
    else if (arg === "--help" || arg === "-h") return "help";
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--draft") options.draft = true;
    else if (arg.startsWith("--author=")) options.authorEmail = arg.slice(9);
    else throw new Error(`Unknown option: ${arg}\n${USAGE}`);
  }

  return options;
}

const report = (line: string) => console.log(line);

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === "help") {
    report(USAGE);
    return;
  }
  const options = parsed;

  validateCatalogue(RELEASE_NOTES);

  report(
    `\nRelease notes — ${RELEASE_NOTES.length} in the catalogue, as ${
      options.draft ? "DRAFT" : "PUBLISHED"
    }${options.dryRun ? " (dry run — nothing will be written)" : ""}\n`
  );

  const db = createDatabaseClient();
  try {
    await db.$connect();
    const authorId = await resolveAuthorId(
      db,
      options.authorEmail ?? process.env.RELEASE_NOTES_AUTHOR_EMAIL,
      report
    );
    const { created, updated } = await publishReleaseNotes(
      db,
      RELEASE_NOTES,
      authorId,
      options,
      report
    );

    report(
      `\n${options.dryRun ? "Would create" : "Created"} ${created}, ${
        options.dryRun ? "would update" : "updated"
      } ${updated}.\n`
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    `\n${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
