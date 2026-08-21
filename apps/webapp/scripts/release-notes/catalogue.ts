/**
 * Release notes catalogue — the source of truth for the in-app **Updates** feed.
 *
 * Every deployment that puts something new in front of users gets an entry
 * here. `scripts/publish-release-notes.ts` upserts each entry into the `Update`
 * table by its stable `id`, which is what `/updates` renders.
 *
 * Keeping the notes in git rather than typing them into the admin dashboard
 * means they are reviewed in the PR that ships the feature, they can be
 * corrected with a normal commit, and re-publishing is safe.
 *
 * ## Adding a note
 *
 * 1. Append an entry to `RELEASE_NOTES` — newest last.
 * 2. `id` must be `release-<YYYY-MM-DD>-<feature-slug>` and must **never**
 *    change once published: it is the primary key of the row, so editing it
 *    orphans the old note and everyone's read state with it.
 * 3. Write for the person using the app, not the person who built it. Say what
 *    they can now do, not which module changed.
 * 4. Publish with `pnpm webapp:release-notes:publish` (see the script's header
 *    for staging and dry-run).
 *
 * @see {@link file://./../publish-release-notes.ts} — the publisher
 * @see {@link file://./../../app/routes/_layout+/updates.tsx} — where these appear
 * @see {@link file://./../../../../.claude/rules/release-note-every-deployment.md}
 */

import type { OrganizationRoles } from "@prisma/client";

/** One entry in the Updates feed. */
export type ReleaseNote = {
  /**
   * Stable primary key, `release-<YYYY-MM-DD>-<feature-slug>`.
   * Never edit one after it has been published.
   */
  id: string;
  /** Headline, shown as the timeline entry's title. */
  title: string;
  /**
   * The date the work reached production, `YYYY-MM-DD`.
   * Published at 09:00 UTC on that date — the feed sorts on this, so the time
   * only matters for two notes sharing a day, which sort by catalogue order.
   */
  date: string;
  /**
   * Markdown body. Keep it to a one-line summary then a bulleted list of what
   * is now possible. Rendered through Markdoc, so avoid `{% %}`.
   */
  content: string;
  /**
   * Who sees it. Omit (or leave empty) for everyone — which is right for
   * almost every note. Only narrow it when the feature is genuinely invisible
   * to other roles.
   */
  targetRoles?: OrganizationRoles[];
  /** Optional "read more" link, e.g. to a docs page. */
  url?: string;
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    id: "release-2026-08-16-equipment-repairs",
    title: "Equipment repairs: report a fault, and stop broken gear going out",
    date: "2026-08-16",
    content: `Faulty equipment now has a home in Shelf. Report a fault the moment you find it, and the gear stops being bookable until somebody fixes it — so nothing broken turns up at a service.

**What you can now do**

- **Report a fault on any asset.** Everyone who handles the gear can raise one — you do not need to be an admin.
- **Faulty equipment cannot be booked.** An asset with an open fault is out of the pool automatically, so it cannot be reserved by mistake.
- **See everything that is out of action** in one list, so you know what needs attention before the next service.
- **Read an asset's fault history** on the asset itself — what broke, when, what was found, and what fixed it. No more rediagnosing the same cable three times.
- **Track a repair through its stages:** reported, diagnosed, and either repaired or written off.
- **Return an item to service** once it is fixed, which puts it straight back into the bookable pool.
- **Spot a degraded kit at a glance** — a kit whose member is out of action is flagged, rather than looking ready to go.
- **Write an asset off** when it is beyond repair, and **reinstate it later** if that turns out to be wrong.

**Who gets told**

- The **team leads are emailed** when a fault is reported.
- **Anyone with the item on an existing booking is warned**, so a fault found on Tuesday does not become a surprise on Sunday.`,
  },
  {
    id: "release-2026-08-16-label-printing",
    title: "Print a whole sheet of QR labels in one go",
    date: "2026-08-16",
    content: `Labelling used to mean downloading a ZIP of images and dragging them one at a time into a Word template. Now you can send a whole sheet to the printer.

**What you can now do**

- **Print an A4 sheet of QR labels** for as many assets as you select, laid out to match real label stationery so the labels land on the labels.
- **Start at any position on the sheet**, so a part-used sheet gets finished instead of binned.
- **Run an alignment check first** — print the test onto plain paper and confirm it lines up before committing a sheet of stationery.

**Worth knowing**

- Check a label near the bottom of the sheet, not the top: a small alignment error compounds down the page.
- The alignment test includes a 100 mm rule. If it does not measure 100 mm, your printer is scaling the page — turn off "fit to page" before printing labels.`,
  },
  {
    id: "release-2026-08-19-help-centre",
    title: "Help is now built into the app",
    date: "2026-08-19",
    content: `There is now a **Help** entry in the sidebar, holding a guide to every part of the system — written for the people using it rather than the people who built it.

**What you can now do**

- **Read a guide for any section** — assets, kits, bookings, audits, repairs, labels, the scanner, reports, team and workspace settings.
- **Search across every guide and question at once**, in plain words. Looking for "cant book" finds the right page.
- **Check the FAQs** for short answers to the things people ask most: why a menu item is missing, the difference between custody and a booking, why labels drift off the sheet.
- **Start with the walkthrough** if you are new. It adapts to your role, so you are not read a lecture about screens you cannot open.

**Around the app**

- Most list screens now carry a one-line explanation of what they are for, with a link into the fuller guide.
- You only ever see guides for the parts of the system your role can reach.`,
  },
  {
    id: "release-2026-08-21-backups-and-security",
    title: "Your data is now backed up every night",
    date: "2026-08-21",
    content: `Everything the team has recorded — every asset, kit, booking, custody record and repair history — is now backed up automatically, and the backups are tested rather than assumed.

**What changed**

- **A full backup runs every night**, encrypted, and is kept for 30 days.
- **The backups are proven, not hoped for.** A restore is carried out automatically every week into a scratch database and checked — because a backup nobody has ever restored is a guess. The first one brought back the whole workspace, sign-ins included.
- **Sign-in accounts are covered too**, so a restore returns a working system rather than an empty shell.

**Also this week**

- Tightened the rules on who can create an account, so the workspace stays invite-only even if a setting is changed by mistake.
- Added browser-level protections against a class of attack that tries to hijack a page or send a form somewhere it should not go.
- Updated the underlying framework to pick up a security fix.

None of this changes how you use the app. It is here so that a bad day — a mistake, a failure, or something worse — costs an hour instead of everything.`,
  },
];
