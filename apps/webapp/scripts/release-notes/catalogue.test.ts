/**
 * Guards the release-notes catalogue.
 *
 * The publisher validates before it writes, but that only helps the person who
 * runs it. These run in CI, so a malformed note is caught in the PR that adds
 * it rather than at deploy time — which matters because the ids are primary
 * keys, and a bad one is only obvious once it has orphaned a published note.
 *
 * @see {@link file://./catalogue.ts}
 * @see {@link file://./../publish-release-notes.ts}
 */

import { describe, expect, it } from "vitest";

import type { ReleaseNote } from "./catalogue";
import { RELEASE_NOTES } from "./catalogue";
import { publishDateFor, validateCatalogue } from "./publish";

/** A minimal valid note, for tests that vary one field at a time. */
function note(overrides: Partial<ReleaseNote> = {}): ReleaseNote {
  return {
    id: "release-2026-08-16-a-feature",
    title: "A feature",
    date: "2026-08-16",
    content: "It does a thing.",
    ...overrides,
  };
}

describe("the shipped catalogue", () => {
  it("is valid", () => {
    expect(() => validateCatalogue(RELEASE_NOTES)).not.toThrow();
  });

  it("has an id whose date matches the note's date", () => {
    // The id embeds the date purely so a human can read the list; letting the
    // two drift makes the catalogue lie about when something shipped.
    for (const entry of RELEASE_NOTES) {
      expect(entry.id).toContain(entry.date);
    }
  });

  it("is ordered oldest first", () => {
    const dates = RELEASE_NOTES.map((entry) => entry.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe("validateCatalogue", () => {
  it("rejects a duplicate id", () => {
    expect(() => validateCatalogue([note(), note()])).toThrow(
      /appears more than once/
    );
  });

  it("rejects an id that isn't release-prefixed", () => {
    // The prefix is what keeps the publisher off hand-written Update rows.
    expect(() =>
      validateCatalogue([note({ id: "2026-08-16-a-feature" })])
    ).toThrow(/not a valid id/);
  });

  it("rejects an unparseable date", () => {
    expect(() => validateCatalogue([note({ date: "16-08-2026" })])).toThrow(
      /unparseable date/
    );
  });

  it("rejects an empty title or body", () => {
    expect(() => validateCatalogue([note({ title: "  " })])).toThrow(
      /has no title/
    );
    expect(() => validateCatalogue([note({ content: "" })])).toThrow(
      /has no content/
    );
  });
});

describe("publishDateFor", () => {
  it("publishes at 09:00 UTC on the note's date", () => {
    expect(publishDateFor(note({ date: "2026-08-16" })).toISOString()).toBe(
      "2026-08-16T09:00:00.000Z"
    );
  });
});
