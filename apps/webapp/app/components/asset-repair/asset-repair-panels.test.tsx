/**
 * OutOfActionPanel — the US-004 enrichment (`design.md` §6.3).
 *
 * The panel shipped with US-001 as heading + one sentence. US-004 gives it the
 * fault text, the reporter, the repeat count and a route into the history —
 * and gives the close dialog the "Reported fault" block that had been built
 * but unreachable since US-005, because no surface had the payload to pass it.
 *
 * What these pin, in order of what would hurt most if it broke:
 *
 * - **`SELF_SERVICE` sees the heading and the first sentence and nothing
 *   else.** That role has no `assetRepair:read` (`DECISIONS.md` #35), so the
 *   layout loader ships them `repairSummary: null`. If this component ever
 *   started rendering fault text from some other source, the disclosure would
 *   be invisible in review;
 * - the repeat count is the thing US-004 exists for, and it must not appear on
 *   a first fault, where "the 1st fault recorded" is noise;
 * - the close dialog now shows what is being closed.
 *
 * @see {@link file://./asset-repair-panels.tsx}
 * @see {@link file://./mark-as-repaired-dialog.test.tsx} the dialog's own suite
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAssetRepairSummary } from "~/hooks/use-asset-repair-state";
import { OutOfActionPanel } from "./asset-repair-panels";

// why: the summary comes from the asset LAYOUT loader via `useRouteLoaderData`.
// Stubbing the hook stubs that loader boundary — the role-degradation logic
// under test is all in the component.
vi.mock("~/hooks/use-asset-repair-state", () => ({
  useAssetRepairSummary: vi.fn(),
}));

// why: `DateS` reads locale and timezone from the ROOT route loader, which
// `createRoutesStub` does not provide. Date formatting is that component's own
// contract and is tested there; what matters here is which facts appear at all.
vi.mock("../shared/date", () => ({
  DateS: ({ date }: { date: string | Date }) => <span>{String(date)}</span>,
}));

const summaryMock = useAssetRepairSummary as unknown as ReturnType<
  typeof vi.fn
>;

const FAULT_TEXT = "Crackles when you wiggle it near the connector";

/** The open repair as the loader ships it (dates already serialized). */
function openRepair(overrides: Record<string, unknown> = {}) {
  return {
    id: "repair-1",
    faultDescription: FAULT_TEXT,
    reportedAt: "2026-08-09T09:00:00.000Z",
    reporterName: "Sam Whitfield",
    closedAt: null,
    closerName: null,
    resolutionNote: null,
    daysOutOfAction: 4,
    state: "open" as const,
    ...overrides,
  };
}

/**
 * Renders the panel inside a router, since its actions contain a link and,
 * when permitted, a fetcher-backed dialog.
 *
 * @param props - Overrides for the panel's props
 */
function renderPanel(props: { canMarkAsRepaired?: boolean } = {}) {
  const Stub = createRoutesStub([
    {
      path: "/assets/:assetId/overview",
      Component: () => (
        <OutOfActionPanel
          hasOpenRepair
          assetId="asset-1"
          assetTitle="Ch 3 handheld radio mic"
          openRepairId="repair-1"
          canMarkAsRepaired={props.canMarkAsRepaired ?? false}
        />
      ),
    },
  ]);

  return render(<Stub initialEntries={["/assets/asset-1/overview"]} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OutOfActionPanel — fault detail", () => {
  it("shows the fault, who reported it, and how many times this has happened", () => {
    summaryMock.mockReturnValue({
      count: 4,
      recent: [openRepair()],
      openRepair: openRepair(),
    });

    renderPanel();

    expect(screen.getByText(`“${FAULT_TEXT}”`)).toBeInTheDocument();
    expect(screen.getByText(/Sam Whitfield/)).toBeInTheDocument();
    // AC3 on the screen a lead lands on first. The ordinal is the whole point:
    // "the 4th fault" is what turns bad luck into a decision to bin the cable.
    expect(
      screen.getByText(/This is the 4th fault recorded on this item\./)
    ).toBeInTheDocument();
  });

  it("says nothing about repeats on a first fault", () => {
    summaryMock.mockReturnValue({
      count: 1,
      recent: [openRepair()],
      openRepair: openRepair(),
    });

    renderPanel();

    // "This is the 1st fault recorded on this item" is noise on an item that
    // has simply broken once.
    expect(screen.queryByText(/fault recorded on this item/)).toBeNull();
    expect(screen.getByText(`“${FAULT_TEXT}”`)).toBeInTheDocument();
  });

  it("offers a route into the full history to anyone who may read it", () => {
    summaryMock.mockReturnValue({
      count: 2,
      recent: [openRepair()],
      openRepair: openRepair(),
    });

    renderPanel();

    // Present for `BASE` too, who cannot close a repair but is explicitly
    // granted the history (#35).
    expect(
      screen.getByRole("link", { name: "View fault history" })
    ).toHaveAttribute("href", "/assets/asset-1/repairs");
  });

  it("tells SELF_SERVICE the item is out of action and nothing more", () => {
    // No `assetRepair:read` → the loader ships no summary at all.
    summaryMock.mockReturnValue(null);

    renderPanel();

    expect(
      screen.getByRole("region", { name: "Out of action" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This item has an open fault report and can't be booked or checked out."
      )
    ).toBeInTheDocument();

    // `design.md` §6.3's role table: no fault text, no reporter, no buttons.
    expect(screen.queryByText(`“${FAULT_TEXT}”`)).toBeNull();
    expect(screen.queryByText(/Sam Whitfield/)).toBeNull();
    expect(
      screen.queryByRole("link", { name: "View fault history" })
    ).toBeNull();
  });

  it("shows the lead what they are closing", async () => {
    summaryMock.mockReturnValue({
      count: 4,
      recent: [openRepair()],
      openRepair: openRepair(),
    });

    renderPanel({ canMarkAsRepaired: true });

    await userEvent.click(
      screen.getByRole("button", { name: "Mark as repaired" })
    );

    /**
     * The debt US-005 recorded in `MarkAsRepairedDialogProps`: the block was
     * built to `design.md` §8 and no caller could supply `reportedFault`,
     * because the enriched payload was US-004's to add. This is that block
     * becoming reachable.
     */
    expect(await screen.findByText("Reported fault")).toBeInTheDocument();
    expect(screen.getAllByText(FAULT_TEXT).length).toBeGreaterThan(0);
  });
});

/**
 * US-008 — the written-off panel (`design.md` §6.3's second variant).
 *
 * The trap this covers: a written-off repair keeps `closedAt = NULL` (#37), so
 * `hasOpenRepair` is TRUE for scrapped gear. Without an explicit branch the
 * page tells someone their binned cable "has an open fault report and can't be
 * booked until the repair is marked complete" — and it is never being marked
 * complete.
 */
describe("OutOfActionPanel — written off", () => {
  const writtenOff = () => ({
    ...openRepair(),
    closedAt: null,
    state: "written-off" as const,
    daysOutOfAction: null,
  });

  it("says it was written off, not that a repair is pending", () => {
    summaryMock.mockReturnValue({
      count: 2,
      recent: [writtenOff()],
      openRepair: writtenOff(),
    });

    renderPanel({ canMarkAsRepaired: true });

    expect(
      screen.getByRole("region", { name: "Written off" })
    ).toBeInTheDocument();
    expect(screen.getByText(/beyond repair/)).toBeInTheDocument();
    expect(screen.queryByText(/open fault report/)).toBeNull();
  });

  it("offers NO 'mark as repaired' button, even to a lead", () => {
    /**
     * US-005 refuses it server-side (#38), and `design.md` §6.3 is explicit:
     * offering a button that always fails is worse than offering none.
     */
    summaryMock.mockReturnValue({
      count: 1,
      recent: [writtenOff()],
      openRepair: writtenOff(),
    });

    renderPanel({ canMarkAsRepaired: true });

    expect(
      screen.queryByRole("button", { name: "Mark as repaired" })
    ).toBeNull();
  });

  it("still shows the danger panel for an ordinary open fault", () => {
    // The branch must not swallow the common case.
    summaryMock.mockReturnValue({
      count: 1,
      recent: [openRepair()],
      openRepair: openRepair(),
    });

    renderPanel({ canMarkAsRepaired: true });

    expect(
      screen.getByRole("region", { name: "Out of action" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark as repaired" })
    ).toBeInTheDocument();
  });
});

/**
 * US-012 — the way back out of a write-off.
 *
 * `design.md` predates this story, so the placement decision is recorded here:
 * Reinstate lives in the SAME actions slot as "Mark as repaired", on the asset
 * page's panel, and nowhere else. One entry point, at the surface that already
 * tells you what the fault was and who scrapped the item — which is the
 * "weight from information, not friction" half of `DECISIONS.md` #103.
 */
describe("OutOfActionPanel — reinstate (US-012)", () => {
  const writtenOffWithActor = () => ({
    ...openRepair(),
    closedAt: null,
    state: "written-off" as const,
    daysOutOfAction: null,
    writtenOffAt: new Date("2026-08-10T09:00:00.000Z"),
    writtenOffByName: "Neil Hobson",
    reinstatedAt: null,
    reinstatedByName: null,
  });

  it("offers Reinstate on a written-off item, to a lead", () => {
    summaryMock.mockReturnValue({
      count: 1,
      recent: [writtenOffWithActor()],
      openRepair: writtenOffWithActor(),
    });

    renderPanel({ canMarkAsRepaired: true });

    expect(
      screen.getByRole("button", { name: "Reinstate" })
    ).toBeInTheDocument();
  });

  it("offers it to NOBODY without the update grant (AC2)", () => {
    /**
     * Cosmetic — the route action is the enforcement — but a `BASE` user who
     * can read the history must not be shown a control that would 403. The
     * same flag gates this and "Mark as repaired", because reinstate reuses
     * `assetRepair:update` rather than taking a new action (#50).
     */
    summaryMock.mockReturnValue({
      count: 1,
      recent: [writtenOffWithActor()],
      openRepair: writtenOffWithActor(),
    });

    renderPanel({ canMarkAsRepaired: false });

    expect(screen.queryByRole("button", { name: "Reinstate" })).toBeNull();
  });

  it("does NOT offer Reinstate on an ordinary open fault", () => {
    /**
     * The two actions are mutually exclusive by construction — one requires
     * `written-off`, the other refuses it. A repair must never offer both, or
     * a lead is asked to choose between repairing and un-scrapping an item
     * that was never scrapped.
     */
    summaryMock.mockReturnValue({
      count: 1,
      recent: [openRepair()],
      openRepair: openRepair(),
    });

    renderPanel({ canMarkAsRepaired: true });

    expect(screen.queryByRole("button", { name: "Reinstate" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Mark as repaired" })
    ).toBeInTheDocument();
  });
});
