/**
 * MarkAsRepairedDialog — unit tests (US-005, `design.md` §8).
 *
 * What these pin, and why each one is worth a test:
 *
 * - **The POST goes to `/assets/:assetId/repairs/:repairId/close`.** Both ids
 *   are in the URL, and the server's CAS matches on BOTH (`DECISIONS.md` #177)
 *   — a mismatched pair is a silent 404, not a crash.
 * - **Server-side validation renders from `fetcher.data`.** A fetcher
 *   submission never populates `useActionData`, so wiring the mandatory
 *   fallback (`CLAUDE.md` § Form Validation Pattern) to the wrong source
 *   compiles, typechecks and shows the user nothing.
 * - **A terminal refusal locks the confirm button** rather than inviting a
 *   retry that cannot succeed (`design.md` §8, "Already closed (400)").
 * - **`maxLength` is 1,000, not `Input`'s 250 default** — otherwise text is
 *   truncated silently against a 1,000-character schema.
 * - **The launcher is absent, never disabled, without the permission or the
 *   repair id** (`design.md` §6.3's role table).
 *
 * The action is stubbed rather than mocked out: these assert the shapes the
 * as-built route really returns (`progress.md` §3.3).
 *
 * @see {@link file://./mark-as-repaired-dialog.tsx}
 * @see {@link file://./asset-repair-panels.tsx}
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
// why: no `vi.mock` anywhere in this suite — nothing here needs a timer, a
// network call or a Prisma client. The only stub is the route action below,
// which exists to OBSERVE the request the component makes, not to replace
// behaviour.
import { describe, expect, it } from "vitest";

import { OutOfActionPanel } from "./asset-repair-panels";
import { MarkAsRepairedDialog } from "./mark-as-repaired-dialog";

/** The success shape `payload()` produces on the close route. */
const SUCCESS_RESPONSE = {
  error: null,
  success: true,
  repairId: "repair-1",
  assetId: "asset-1",
  assetTitle: "Ch 3 handheld radio mic",
};

/**
 * Renders the dialog inside a router with a stubbed close action.
 *
 * @param action - What `POST .../close` resolves to
 * @returns The `formData` recorder, so a test can assert what was submitted
 */
function renderDialog(action: () => unknown = () => SUCCESS_RESPONSE) {
  const submitted: {
    url?: string;
    resolutionNote?: FormDataEntryValue | null;
  } = {};

  const Stub = createRoutesStub([
    {
      path: "/assets/:assetId/overview",
      Component: () => (
        <MarkAsRepairedDialog
          assetId="asset-1"
          repairId="repair-1"
          assetTitle="Ch 3 handheld radio mic"
        />
      ),
    },
    {
      path: "/assets/:assetId/repairs/:repairId/close",
      action: async ({ request }) => {
        submitted.url = new URL(request.url).pathname;
        submitted.resolutionNote = (await request.formData()).get(
          "resolutionNote"
        );
        return action();
      },
    },
  ]);

  render(<Stub initialEntries={["/assets/asset-1/overview"]} />);

  return submitted;
}

/** Opens the dialog from its launcher and returns the note textarea. */
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Mark as repaired" }));
  return screen.getByRole("textbox", { name: "What was done? (optional)" });
}

/**
 * The dialog's confirm button.
 *
 * The launcher and the confirm share the label by design (`design.md` §8), so
 * they are told apart by `type` — which is exactly the prop
 * `local-rules/require-button-type` exists to keep explicit.
 */
function confirmButton(): HTMLButtonElement {
  const submit = screen
    .getAllByRole("button", { name: /^(Mark as repaired|Saving…)$/ })
    .find((button) => button.getAttribute("type") === "submit");

  if (!submit) {
    throw new Error("The dialog's submit button is not rendered");
  }

  return submit as HTMLButtonElement;
}

describe("MarkAsRepairedDialog", () => {
  it("opens from the launcher and focuses the note field", async () => {
    const user = userEvent.setup();
    renderDialog();

    const note = await openDialog(user);

    expect(
      screen.getByText(
        "Kept with the fault so the next person can see how it was fixed."
      )
    ).toBeInTheDocument();
    // `useAutoFocus` defers to the next animation frame, which is what lets it
    // win against the Dialog's own synchronous focus-first-focusable effect.
    await waitFor(() => expect(note).toHaveFocus());
  });

  it("states the consequence using the asset's title", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    expect(
      screen.getByText(
        "Ch 3 handheld radio mic goes straight back into the pool and can be booked again."
      )
    ).toBeInTheDocument();
  });

  it("posts the note to the asset+repair URL and closes on success", async () => {
    const user = userEvent.setup();
    const submitted = renderDialog();

    await user.type(await openDialog(user), "Re-terminated the male XLR");
    await user.click(confirmButton());

    await waitFor(() => {
      expect(submitted.url).toBe("/assets/asset-1/repairs/repair-1/close");
    });
    expect(submitted.resolutionNote).toBe("Re-terminated the male XLR");

    // The dialog closes itself; the toast and the panel's disappearance are the
    // server's `sendNotification` and the fetcher's revalidation respectively.
    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: "What was done? (optional)" })
      ).not.toBeInTheDocument();
    });
  });

  it("submits an empty note rather than blocking — the note is optional", async () => {
    const user = userEvent.setup();
    const submitted = renderDialog();

    const note = await openDialog(user);
    expect(note).not.toBeRequired();

    await user.click(confirmButton());

    await waitFor(() => expect(submitted.url).toBeDefined());
    // "" reaches the server, where `closeRepairSchema` collapses it to
    // `undefined` and the service stores NULL (`DECISIONS.md` #185). The client
    // must not invent its own representation of "no note".
    expect(submitted.resolutionNote).toBe("");
  });

  it("lets the user type the full 1,000 characters the schema allows", async () => {
    const user = userEvent.setup();
    renderDialog();

    // `Input`'s textarea defaults to maxLength 250 — the silent-truncation trap.
    expect(await openDialog(user)).toHaveAttribute("maxLength", "1000");
  });

  it("renders a server-side validation error field-level, from fetcher.data", async () => {
    const user = userEvent.setup();
    renderDialog(() => ({
      error: {
        message: "Keep the note under 1,000 characters.",
        label: "Asset Repair",
        additionalData: {
          validationErrors: {
            resolutionNote: {
              message: "Keep the note under 1,000 characters.",
            },
          },
        },
      },
    }));

    const note = await openDialog(user);
    await user.click(confirmButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Keep the note under 1,000 characters.");
    // The error is announced AND reachable from the field, not just coloured.
    expect(note).toHaveAttribute("aria-invalid", "true");
    expect(note.getAttribute("aria-describedby")).toContain(alert.id);
    // Field-level: still fixable, so the dialog stays usable.
    expect(confirmButton()).toBeEnabled();
  });

  it("shows a terminal refusal inline and locks the confirm button", async () => {
    const user = userEvent.setup();
    renderDialog(() => ({
      error: {
        message:
          "This fault report was already closed — someone got there first. Close this and refresh.",
        label: "Asset Repair",
        title: "Already closed",
      },
    }));

    await openDialog(user);
    await user.click(confirmButton());

    expect(
      await screen.findByText(
        "This fault report was already closed — someone got there first. Close this and refresh."
      )
    ).toBeInTheDocument();
    // Re-submitting the same body cannot change the outcome of any refusal the
    // action produces today, so the button must not invite it.
    await waitFor(() => expect(confirmButton()).toBeDisabled());
    // …and the dialog stays open with the typed note intact.
    expect(
      screen.getByRole("textbox", { name: "What was done? (optional)" })
    ).toBeInTheDocument();
  });

  it("closes on Cancel without submitting", async () => {
    const user = userEvent.setup();
    const submitted = renderDialog();

    await openDialog(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: "What was done? (optional)" })
      ).not.toBeInTheDocument();
    });
    expect(submitted.url).toBeUndefined();
  });

  it("shows the reported fault, with a reachable Show more toggle", async () => {
    const user = userEvent.setup();
    // Long enough that `line-clamp-4` really truncates — the toggle is
    // deliberately NOT offered on a fault that already fits.
    const longFault =
      `Crackles when you wiggle it near the connector. ${"It cut out repeatedly during the evening service. ".repeat(
        6
      )}`.trim();
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <MarkAsRepairedDialog
            assetId="asset-1"
            repairId="repair-1"
            assetTitle="Ch 3 handheld radio mic"
            reportedFault={{
              faultDescription: longFault,
              reporterName: "Sam Whitfield",
            }}
          />
        ),
      },
    ]);
    render(<Stub initialEntries={["/"]} />);

    await openDialog(user);

    expect(screen.getByText(longFault)).toBeInTheDocument();
    expect(screen.getByText("Sam Whitfield")).toBeInTheDocument();

    // A button, not a tooltip: the fault text is why the lead is here and it
    // must be reachable on touch and by keyboard.
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(
      screen.getByRole("button", { name: "Show less" })
    ).toBeInTheDocument();
  });
});

describe("OutOfActionPanel — the US-005 launcher", () => {
  /** Renders the panel inside a router (the dialog uses `useFetcher`). */
  function renderPanel(props: {
    openRepairId: string | null;
    canMarkAsRepaired: boolean;
  }) {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <OutOfActionPanel
            hasOpenRepair
            assetId="asset-1"
            assetTitle="Ch 3 handheld radio mic"
            {...props}
          />
        ),
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
  }

  it("offers the launcher to a role that can close a repair", () => {
    renderPanel({ openRepairId: "repair-1", canMarkAsRepaired: true });

    expect(
      screen.getByRole("button", { name: "Mark as repaired" })
    ).toBeInTheDocument();
  });

  it("omits the launcher entirely for BASE / SELF_SERVICE", () => {
    renderPanel({ openRepairId: "repair-1", canMarkAsRepaired: false });

    // Absent, never disabled — `design.md` §6.3. The panel itself still shows.
    expect(
      screen.getByRole("region", { name: "Out of action" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark as repaired" })
    ).not.toBeInTheDocument();
  });

  it("omits the launcher when there is no repair id to post to", () => {
    renderPanel({ openRepairId: null, canMarkAsRepaired: true });

    expect(
      screen.queryByRole("button", { name: "Mark as repaired" })
    ).not.toBeInTheDocument();
  });

  it("renders nothing at all when the asset is healthy", () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <OutOfActionPanel
            hasOpenRepair={false}
            assetId="asset-1"
            assetTitle="Ch 3 handheld radio mic"
            openRepairId={null}
            canMarkAsRepaired
          />
        ),
      },
    ]);
    render(<Stub initialEntries={["/"]} />);

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
