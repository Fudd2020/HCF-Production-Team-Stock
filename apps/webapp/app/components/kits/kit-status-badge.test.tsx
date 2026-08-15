/**
 * KitStatusBadge — US-006 AC1 and AC3.
 *
 * The badge has to answer a question a lead asks while standing in front of a
 * rack: *why* can't I book this kit? Two causes make a kit unbookable and they
 * demand completely different responses — an admin parked a member (a setting
 * somebody chose) versus a member is broken (a job somebody has to do).
 * Collapsing them into one "unavailable" chip is what sends someone opening six
 * assets one at a time.
 *
 * AC3 gets equal weight here: a fully healthy kit must be **byte-identical** to
 * how it looked before this story, because that is every kit in the workspace
 * on day one.
 *
 * @see {@link file://./kit-status-badge.tsx}
 */

import { KitStatus } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KitStatusBadge } from "./kit-status-badge";

describe("KitStatusBadge", () => {
  it("shows only the status for a healthy, bookable kit", () => {
    // AC3 — the day-one case for every kit that has never had a fault.
    render(<KitStatusBadge status={KitStatus.AVAILABLE} availableToBook />);

    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.queryByText("Member out of action")).toBeNull();
  });

  it("flags a member out of action alongside the kit's own status", () => {
    /**
     * AC1's core requirement: the marking is ADDITIONAL to, and distinct from,
     * the kit's own AVAILABLE / IN_CUSTODY / CHECKED_OUT status. A kit can be
     * checked out AND have a broken member, and both facts matter.
     */
    render(
      <KitStatusBadge
        status={KitStatus.CHECKED_OUT}
        availableToBook
        hasFaultyMember
      />
    );

    expect(screen.getByText("Checked Out")).toBeInTheDocument();
    expect(screen.getByText("Member out of action")).toBeInTheDocument();
  });

  it("distinguishes a broken member from a manually parked one", () => {
    // The whole point of the story. Same unbookable outcome, different cause,
    // different chip — one is fixable with a screwdriver, the other with a
    // toggle.
    const { unmount } = render(
      <KitStatusBadge status={KitStatus.AVAILABLE} availableToBook={false} />
    );

    // Parked: the generic unavailable badge, no repair wording.
    expect(screen.queryByText("Member out of action")).toBeNull();
    unmount();

    render(
      <KitStatusBadge
        status={KitStatus.AVAILABLE}
        availableToBook={false}
        hasFaultyMember
      />
    );

    expect(screen.getByText("Member out of action")).toBeInTheDocument();
  });

  it("shows one reason, not two, when a kit is both parked and broken", () => {
    /**
     * `availableToBook: false` is frequently a CONSEQUENCE of the same
     * situation rather than an independent fact, so rendering both chips would
     * state the same problem twice and invite the reader to think there are two
     * things to fix. The repair wins because it is the actionable one.
     */
    render(
      <KitStatusBadge
        status={KitStatus.AVAILABLE}
        availableToBook={false}
        hasFaultyMember
      />
    );

    expect(screen.getByText("Member out of action")).toBeInTheDocument();
    expect(screen.queryByTitle(/marked as unavailable/i)).toBeNull();
  });

  it("says nothing about the fault itself", () => {
    /**
     * `SELF_SERVICE` can read kits but holds no `assetRepair` grant
     * (`DECISIONS.md` #35). The kit marking conveys availability and nothing
     * more — no description, no reporter, no diagnosis — so this surface never
     * becomes a back door to fault detail.
     */
    render(
      <KitStatusBadge
        status={KitStatus.AVAILABLE}
        availableToBook={false}
        hasFaultyMember
      />
    );

    const text = document.body.textContent ?? "";

    expect(text).toContain("Member out of action");
    // Nothing that could carry who/what/why.
    expect(text).not.toMatch(/reported|fault report|repair note|by /i);
  });
});
