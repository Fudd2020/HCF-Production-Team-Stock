/**
 * FaultHistoryCard — unit tests (US-004 AC3, AC4).
 *
 * The card exists for one sentence in the story: "the number of past faults is
 * visible without opening a sub-page or counting rows manually". So what these
 * pin is the difference between the COUNT and the ROWS — three rows above a
 * `12` is the repeat offender becoming obvious, and a card that quietly showed
 * `3` would satisfy every other test while destroying the story's whole value.
 *
 * They also pin the two ways the card renders nothing, which must never be
 * conflated in the code even though they look identical on screen: the asset
 * has never had a fault, and the viewer may not read fault history at all.
 *
 * @see {@link file://./fault-history-card.tsx}
 */

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAssetRepairSummary } from "~/hooks/use-asset-repair-state";
import { FaultHistoryCard } from "./fault-history-card";

// why: the summary comes from the asset LAYOUT loader via `useRouteLoaderData`,
// which needs a router. Stubbing the hook is stubbing the loader boundary, not
// the component's own logic — the count/rows decision under test is all here.
vi.mock("~/hooks/use-asset-repair-state", () => ({
  useAssetRepairSummary: vi.fn(),
}));

// why: `Button to=` renders a react-router `Link`, which needs a router
// context. The card's link target is asserted through this stub.
vi.mock("~/components/shared/button", () => ({
  Button: ({ to, children }: { to?: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

// why: `DateS` reads the viewer's locale and timezone from the ROOT route
// loader, so it needs a data router. Same stub as
// `list-asset-content.test.tsx`. Date FORMATTING is that component's contract
// and is tested there; what matters here is the count and the rows.
vi.mock("../shared/date", () => ({
  DateS: ({ date }: { date: string | Date }) => <span>{String(date)}</span>,
}));

const summaryMock = useAssetRepairSummary as unknown as ReturnType<
  typeof vi.fn
>;

/** One history row as the loader ships it (dates already serialized). */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "repair-1",
    faultDescription: "Crackles when the cable is moved",
    reportedAt: "2026-08-01T09:00:00.000Z",
    reporterName: "Sam Whitfield",
    closedAt: null,
    closerName: null,
    resolutionNote: null,
    daysOutOfAction: 12,
    state: "open" as const,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FaultHistoryCard", () => {
  it("shows the ALL-TIME count, not the number of rows it renders", () => {
    summaryMock.mockReturnValue({
      count: 12,
      recent: [row(), row({ id: "repair-2" }), row({ id: "repair-3" })],
      openRepair: null,
    });

    render(<FaultHistoryCard assetId="asset-1" />);

    // AC3. The card caps its rows at three; the pill must still say twelve, or
    // the repeat offender is invisible on the screen that exists to show it.
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(
      screen.getAllByText("Crackles when the cable is moved")
    ).toHaveLength(3);
  });

  it("links to the tab that holds the rest", () => {
    summaryMock.mockReturnValue({
      count: 4,
      recent: [row()],
      openRepair: null,
    });

    render(<FaultHistoryCard assetId="asset-1" />);

    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute(
      "href",
      "/assets/asset-1/repairs"
    );
  });

  it("renders each row's state as a word, never colour alone", () => {
    summaryMock.mockReturnValue({
      count: 2,
      recent: [row(), row({ id: "repair-2", state: "repaired" })],
      openRepair: null,
    });

    render(<FaultHistoryCard assetId="asset-1" />);

    // `design.md` §13 item 3: every chip carries its own word, so the state
    // survives greyscale, colour-blindness and a screen reader.
    expect(screen.getByText("In repair")).toBeInTheDocument();
    expect(screen.getByText("Repaired")).toBeInTheDocument();
  });

  it("renders nothing for an asset that has never had a fault", () => {
    summaryMock.mockReturnValue({ count: 0, recent: [], openRepair: null });

    const { container } = render(<FaultHistoryCard assetId="asset-1" />);

    /**
     * AC4's empty state lives on the TAB, which is always present. An empty
     * card on every healthy asset would be chrome, not information — the same
     * behaviour as `AssetReminderCards` (`design.md` D1).
     */
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the viewer may not read fault history", () => {
    // `null` means SELF_SERVICE, whose loader payload omits the summary
    // entirely (`DECISIONS.md` #35). Distinct from `count: 0` in the code even
    // though both render as absence.
    summaryMock.mockReturnValue(null);

    const { container } = render(<FaultHistoryCard assetId="asset-1" />);

    expect(container).toBeEmptyDOMElement();
  });
});
