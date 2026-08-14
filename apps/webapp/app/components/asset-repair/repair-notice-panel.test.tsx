/**
 * RepairNoticePanel — unit tests.
 *
 * The panel's contract is mostly accessibility, and accessibility regressions
 * are invisible in review, so that is what these pin:
 *
 * - the heading is the accessible name of the region (colour is never the only
 *   carrier of meaning);
 * - `success` announces politely via `role="status"`, while the persistent
 *   tones are `role="region"` — `role="alert"` would interrupt a screen reader
 *   on every page load, and the out-of-action panel is present on load;
 * - a panel is NOT dismissible unless asked, because "this item cannot be
 *   booked" is a fact and not a notification;
 * - the dismiss control is an icon-only button and therefore needs its label.
 *
 * @see {@link file://./repair-notice-panel.tsx}
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RepairNoticePanel } from "./repair-notice-panel";

describe("RepairNoticePanel", () => {
  it("names the region with its heading", () => {
    render(
      <RepairNoticePanel tone="danger" title="Out of action">
        <p>This item has an open fault report.</p>
      </RepairNoticePanel>
    );

    expect(
      screen.getByRole("region", { name: "Out of action" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("This item has an open fault report.")
    ).toBeInTheDocument();
  });

  it("announces the success tone politely rather than as an alert", () => {
    render(
      <RepairNoticePanel tone="success" title="Fault reported">
        <p>Thanks.</p>
      </RepairNoticePanel>
    );

    expect(
      screen.getByRole("status", { name: "Fault reported" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("is not dismissible by default", () => {
    render(
      <RepairNoticePanel tone="danger" title="Out of action">
        <p>Body</p>
      </RepairNoticePanel>
    );

    expect(
      screen.queryByRole("button", { name: "Dismiss" })
    ).not.toBeInTheDocument();
  });

  it("renders a labelled dismiss control when asked, and calls back", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(
      <RepairNoticePanel
        tone="success"
        title="Fault reported"
        dismissible
        onDismiss={onDismiss}
      >
        <p>Body</p>
      </RepairNoticePanel>
    );

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders actions when supplied", () => {
    render(
      <RepairNoticePanel
        tone="neutral"
        title="Written off"
        actions={
          <button type="button" data-testid="an-action">
            Do something
          </button>
        }
      >
        <p>Body</p>
      </RepairNoticePanel>
    );

    expect(screen.getByTestId("an-action")).toBeInTheDocument();
  });
});
