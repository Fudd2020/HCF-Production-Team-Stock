/**
 * Guards the Help Centre content.
 *
 * The value of these is structural, not editorial: they catch the mistakes
 * that make a guide unreachable or a link dead, which are invisible until
 * somebody clicks. Prose is reviewed by reading it.
 *
 * @see {@link file://./content.ts}
 */

import { describe, expect, it } from "vitest";
import type { HelpAudience } from "./content";
import {
  HELP_FAQS,
  HELP_TOPICS,
  getHelpTopic,
  helpBlocksFor,
  helpFaqsFor,
  helpTopicsFor,
  searchHelp,
} from "./content";

/** The most restricted reader: BASE, no bookings, no admin. */
const base: HelpAudience = {
  isAdministratorOrOwner: false,
  isSelfService: false,
  isBaseOrSelfService: true,
  isAdmin: false,
  canUseBookings: false,
};

/** A workspace administrator with bookings available. */
const owner: HelpAudience = {
  isAdministratorOrOwner: true,
  isSelfService: false,
  isBaseOrSelfService: false,
  isAdmin: false,
  canUseBookings: true,
};

/** Self service — has bookings, but not the organising screens. */
const selfService: HelpAudience = {
  isAdministratorOrOwner: false,
  isSelfService: true,
  isBaseOrSelfService: true,
  isAdmin: false,
  canUseBookings: true,
};

describe("the topic catalogue", () => {
  it("has unique ids", () => {
    const ids = HELP_TOPICS.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only cross-links to topics that exist", () => {
    // A related link pointing at a deleted topic renders a dead card.
    for (const topic of HELP_TOPICS) {
      for (const relatedId of topic.related ?? []) {
        expect(
          getHelpTopic(relatedId),
          `${topic.id} → ${relatedId}`
        ).toBeDefined();
      }
    }
  });

  it("gives every topic a body for every audience", () => {
    for (const audience of [base, owner, selfService]) {
      for (const topic of HELP_TOPICS) {
        expect(helpBlocksFor(topic, audience).length, topic.id).toBeGreaterThan(
          0
        );
      }
    }
  });
});

describe("audience filtering", () => {
  it("hides the organising and workspace guides from base users", () => {
    const ids = helpTopicsFor(base).map((topic) => topic.id);
    expect(ids).not.toContain("organising");
    expect(ids).not.toContain("workspace-settings");
    expect(ids).not.toContain("reports");
  });

  it("hides bookings when the workspace cannot use them", () => {
    expect(helpTopicsFor(base).map((t) => t.id)).not.toContain("bookings");
    expect(helpTopicsFor(owner).map((t) => t.id)).toContain("bookings");
  });

  it("hides repairs from self service, matching the sidebar", () => {
    // The sidebar gates Repairs on `isSelfService`, NOT `isBaseOrSelfService`:
    // BASE may read the repairs list. The guide must follow the same rule.
    expect(helpTopicsFor(selfService).map((t) => t.id)).not.toContain(
      "repairs"
    );
    expect(helpTopicsFor(base).map((t) => t.id)).toContain("repairs");
  });

  it("always offers the starting guides to everyone", () => {
    for (const audience of [base, owner, selfService]) {
      const ids = helpTopicsFor(audience).map((topic) => topic.id);
      expect(ids).toContain("getting-started");
      expect(ids).toContain("roles");
    }
  });
});

describe("FAQs", () => {
  it("has unique ids", () => {
    const ids = HELP_FAQS.map((faq) => faq.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only references topics that exist", () => {
    for (const faq of HELP_FAQS) {
      if (faq.topic) {
        expect(getHelpTopic(faq.topic), faq.id).toBeDefined();
      }
    }
  });

  it("never shows an answer about a guide the reader can't see", () => {
    // A question inherits its topic's visibility — otherwise a BASE user reads
    // an answer about a screen that isn't in their sidebar.
    const visibleTopics = new Set(helpTopicsFor(base).map((topic) => topic.id));
    for (const faq of helpFaqsFor(base)) {
      if (faq.topic) {
        expect(visibleTopics.has(faq.topic), faq.id).toBe(true);
      }
    }
  });
});

describe("searchHelp", () => {
  it("returns nothing for a blank query", () => {
    expect(searchHelp("   ", owner)).toEqual({ topics: [], faqs: [] });
  });

  it("matches words in a guide's body, not just its title", () => {
    const { topics } = searchHelp("stocktake", owner);
    expect(topics.map((topic) => topic.id)).toContain("audits");
  });

  it("requires every word, in any order and any case", () => {
    expect(searchHelp("PRINT labels", owner).topics.map((t) => t.id)).toContain(
      "labels"
    );
    expect(
      searchHelp("labels chrysanthemum", owner).topics.map((t) => t.id)
    ).not.toContain("labels");
  });

  it("never returns a guide the reader can't open", () => {
    // Searching is the easiest way to leak a hidden guide back into view.
    const { topics } = searchHelp("booking", base);
    expect(topics.map((topic) => topic.id)).not.toContain("bookings");
  });
});
