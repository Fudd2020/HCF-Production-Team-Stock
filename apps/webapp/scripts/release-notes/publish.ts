/**
 * Release-notes publishing logic.
 *
 * Pure, side-effect-free module: importing it does nothing. The CLI wrapper in
 * `scripts/publish-release-notes.ts` is what actually runs it — the split
 * exists so tests can import `validateCatalogue` without a `main()` firing and
 * opening a connection to whatever database `.env` points at.
 *
 * @see {@link file://./catalogue.ts} — the notes
 * @see {@link file://./../publish-release-notes.ts} — the CLI entry point
 */

import type { ExtendedPrismaClient } from "@shelf/database";

import type { ReleaseNote } from "./catalogue";

/** Every note id must match this, so the publisher can never touch a hand-written Update. */
const ID_PATTERN = /^release-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;

/** The time of day a note is published at. See `ReleaseNote.date`. */
const PUBLISH_TIME_UTC = "T09:00:00.000Z";

export type PublishOptions = {
  /** Print the plan and write nothing. */
  dryRun: boolean;
  /** Write the notes as DRAFT rather than PUBLISHED. */
  draft: boolean;
  /** Explicit author address, overriding the fallback. */
  authorEmail?: string;
};

export type PublishResult = { created: number; updated: number };

/** Where progress is reported to. Injected so tests stay silent. */
export type Reporter = (line: string) => void;

/**
 * Rejects a catalogue that would write something surprising.
 *
 * Runs before any database work, so a malformed entry costs nothing.
 *
 * @param notes - The catalogue as authored
 * @throws {Error} On a duplicate id, a malformed id, an unparseable date, or empty copy
 */
export function validateCatalogue(notes: ReleaseNote[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const note of notes) {
    if (!ID_PATTERN.test(note.id)) {
      problems.push(
        `"${note.id}" is not a valid id — expected release-<YYYY-MM-DD>-<slug>`
      );
    }
    if (seen.has(note.id)) {
      problems.push(`"${note.id}" appears more than once`);
    }
    seen.add(note.id);

    if (Number.isNaN(new Date(`${note.date}${PUBLISH_TIME_UTC}`).getTime())) {
      problems.push(`"${note.id}" has an unparseable date: ${note.date}`);
    }
    if (!note.title.trim()) problems.push(`"${note.id}" has no title`);
    if (!note.content.trim()) problems.push(`"${note.id}" has no content`);
  }

  if (problems.length > 0) {
    throw new Error(
      `Release notes catalogue is invalid:\n  - ${problems.join("\n  - ")}`
    );
  }
}

/**
 * The instant a note becomes visible in the feed.
 *
 * @param note - The catalogue entry
 * @returns 09:00 UTC on the note's date
 */
export function publishDateFor(note: ReleaseNote): Date {
  return new Date(`${note.date}${PUBLISH_TIME_UTC}`);
}

/**
 * Finds the user to record as the notes' author.
 *
 * `Update.createdById` is a required relation, so every note needs a real one.
 * Fails loudly rather than guessing.
 *
 * @param db - Prisma client
 * @param email - An explicit address from `--author` or the environment
 * @param report - Progress reporter
 * @returns The user's id
 * @throws {Error} When the named user doesn't exist, or no global admin does
 */
export async function resolveAuthorId(
  db: ExtendedPrismaClient,
  email: string | undefined,
  report: Reporter
): Promise<string> {
  if (email) {
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) {
      throw new Error(
        `No user with the email "${email}". Pass --author=<email> for an account that exists.`
      );
    }
    return user.id;
  }

  // Fall back to the longest-standing global admin — the person who would
  // otherwise be typing these into the admin dashboard by hand.
  const admin = await db.user.findFirst({
    where: { roles: { some: { name: "ADMIN" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (!admin) {
    throw new Error(
      "No user holds the global ADMIN role, so there is nobody to attribute the notes to. " +
        "Pass --author=<email>, or set RELEASE_NOTES_AUTHOR_EMAIL."
    );
  }

  report(`  author: ${admin.email} (oldest global admin)`);
  return admin.id;
}

/**
 * Upserts every catalogue entry into the `Update` table.
 *
 * Idempotent, and it only ever touches rows whose id it owns. There is no
 * delete here by design.
 *
 * @param db - Prisma client
 * @param notes - The catalogue to publish
 * @param authorId - User recorded as `createdById` on newly created rows
 * @param options - Dry-run and draft flags
 * @param report - Progress reporter
 * @returns How many rows were created and how many already existed
 */
export async function publishReleaseNotes(
  db: ExtendedPrismaClient,
  notes: ReleaseNote[],
  authorId: string,
  options: PublishOptions,
  report: Reporter
): Promise<PublishResult> {
  const status = options.draft ? "DRAFT" : "PUBLISHED";
  let created = 0;
  let updated = 0;

  for (const note of notes) {
    const existing = await db.update.findUnique({
      where: { id: note.id },
      select: { id: true },
    });

    report(`  ${existing ? "~" : "+"} ${note.id} — ${note.title}`);

    if (!options.dryRun) {
      await db.update.upsert({
        where: { id: note.id },
        // `createdById` is set only on create: re-publishing a corrected note
        // must not reattribute one somebody else originally shipped. viewCount
        // and clickCount are omitted for the same reason — they carry over,
        // and so does everyone's read state, which hangs off the id.
        create: {
          id: note.id,
          title: note.title,
          content: note.content,
          url: note.url ?? null,
          publishDate: publishDateFor(note),
          status,
          targetRoles: note.targetRoles ?? [],
          createdById: authorId,
        },
        update: {
          title: note.title,
          content: note.content,
          url: note.url ?? null,
          publishDate: publishDateFor(note),
          status,
          targetRoles: note.targetRoles ?? [],
        },
      });
    }

    if (existing) updated += 1;
    else created += 1;
  }

  return { created, updated };
}
