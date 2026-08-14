/**
 * Report-fault page — component tests for the route's default export (US-001).
 *
 * These pin the four things that are invisible to typecheck and to review:
 *
 * 1. **Server-side validation is displayed.** Client validation can be
 *    bypassed or diverge from the server, so `getValidationErrors` output must
 *    reach the field. A form that only shows `zo.errors` passes every test
 *    that never posts (`CLAUDE.md` § Form Validation Pattern, US-001 AC2).
 * 2. **Cancel goes somewhere real.** A nullish `to` renders a dead `<button>`
 *    or an `<a href="/">`, silently, past typecheck
 *    (`.claude/rules/resolve-nullish-button-to.md`).
 * 3. **The textarea's `maxLength` is 1,000, not `Input`'s 250 default** —
 *    otherwise text is truncated with no message against a 1,000-char schema.
 * 4. **The two "no form" branches** — quantity-tracked (`DECISIONS.md` #23)
 *    and an already-open fault (US-001 AC5) — replace the form rather than
 *    offering a submission that cannot succeed.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId_.report-fault.tsx}
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ReportFaultPage from "~/routes/_layout+/assets.$assetId_.report-fault";

const routerMocks = vi.hoisted(() => ({
  useLoaderData: vi.fn(),
  useActionData: vi.fn(),
  useLocation: vi.fn(),
  useNavigation: vi.fn(),
}));

// why: the component reads loader/action data and the navigation state. We
// drive all four directly so each branch can be rendered in isolation without
// standing up a router. `Form` and `Link` are reduced to their DOM elements so
// assertions can read `href` / `maxLength` off the real nodes.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: routerMocks.useLoaderData,
    useActionData: routerMocks.useActionData,
    useLocation: routerMocks.useLocation,
    useNavigation: routerMocks.useNavigation,
    Link: ({ to, children, ...rest }: Record<string, unknown>) => (
      <a {...rest} href={typeof to === "string" ? to : undefined}>
        {children as React.ReactNode}
      </a>
    ),
    Form: ({ children, ...rest }: Record<string, unknown>) => (
      <form {...rest}>{children as React.ReactNode}</form>
    ),
    NavLink: ({ to, children, ...rest }: Record<string, unknown>) => (
      <a {...rest} href={typeof to === "string" ? to : undefined}>
        {children as React.ReactNode}
      </a>
    ),
  };
});

// why: the route imports its service + db at module scope for the loader and
// action. Neither is exercised here, but the imports must resolve.
vi.mock("~/database/db.server", () => ({ db: {} }));
vi.mock("~/modules/asset-repair/service.server", () => ({
  reportAssetFault: vi.fn(),
  QUANTITY_TRACKED_REPAIR_MESSAGE:
    "Fault reports are recorded against individually-tracked assets.",
}));
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: `Header` reads `header` off the closest loader data and renders
// breadcrumbs + the command palette, none of which is under test. Reduced to
// its title so the page shape stays assertable.
vi.mock("~/components/layout/header", () => ({
  default: ({ slots }: { slots?: Record<string, React.ReactNode> }) => (
    <header>
      <h1>Report a fault</h1>
      {slots?.["left-of-title"]}
    </header>
  ),
}));

// why: `AssetImage` self-heals expired Supabase signed URLs over the network.
// Irrelevant here and it would fire fetches in the test environment.
vi.mock("~/components/assets/asset-image/component", () => ({
  AssetImage: ({ alt }: { alt: string }) => (
    <span role="img" aria-label={alt} />
  ),
}));

const ASSET = {
  id: "asset-1",
  title: "Ch 3 handheld radio mic",
  type: "INDIVIDUAL" as const,
  mainImage: null,
  thumbnailImage: null,
  mainImageExpiration: null,
};

type LoaderOverrides = Partial<{
  referer: string | null;
  hasOpenRepair: boolean;
  isQuantityTracked: boolean;
}>;

function renderPage(overrides: LoaderOverrides = {}) {
  routerMocks.useLoaderData.mockReturnValue({
    asset: ASSET,
    header: { title: "Report a fault", subHeading: ASSET.title },
    referer: null,
    hasOpenRepair: false,
    isQuantityTracked: false,
    quantityTrackedMessage:
      "Fault reports are recorded against individually-tracked assets.",
    ...overrides,
  });
  return render(<ReportFaultPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  routerMocks.useActionData.mockReturnValue(undefined);
  routerMocks.useLocation.mockReturnValue({
    pathname: "/assets/asset-1/report-fault",
    search: "",
    hash: "",
    state: null,
    key: "default",
  });
  routerMocks.useNavigation.mockReturnValue({ state: "idle" });
});

describe("ReportFaultPage", () => {
  it("warns up front that reporting takes the item out of action, and that it does not cancel bookings", () => {
    renderPage();

    expect(
      screen.getByRole("region", { name: "This takes the item out of action" })
    ).toBeInTheDocument();
    // The "doesn't cancel any booking" sentence is load-bearing: a volunteer
    // who thinks reporting has cancelled Sunday will not report it.
    expect(
      screen.getByText(/doesn't cancel any booking it's already on/i)
    ).toBeInTheDocument();
  });

  it("allows the full 1,000 characters the schema allows", () => {
    renderPage();

    // `Input`'s textarea defaults to maxLength 250. Against a 1,000-char
    // schema that silently truncates with no message at all.
    expect(screen.getByLabelText("What's wrong?")).toHaveAttribute(
      "maxlength",
      "1000"
    );
  });

  it("links helper text and the character counter to the field", () => {
    renderPage();

    const field = screen.getByLabelText("What's wrong?");
    const describedBy = field.getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();
    const ids = describedBy!.split(" ");
    // Every referenced id must resolve to a real node, or the association is
    // decorative and a screen reader announces nothing.
    ids.forEach((id) => {
      expect(document.getElementById(id)).not.toBeNull();
    });
    expect(screen.getByText("0/1000")).toBeInTheDocument();
  });

  it("shows a SERVER-side validation error on the field, with aria-invalid and an alert", () => {
    routerMocks.useActionData.mockReturnValue({
      error: {
        message: "Validation failed",
        label: "Asset Repair",
        additionalData: {
          validationErrors: {
            faultDescription: { message: "Describe the fault" },
          },
        },
      },
    });

    renderPage();

    const field = screen.getByLabelText("What's wrong?");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Describe the fault");
  });

  it("surfaces a non-field refusal (already reported) as a panel rather than a generic failure", () => {
    routerMocks.useActionData.mockReturnValue({
      error: {
        message: "This asset already has an open fault report.",
        title: "Already reported",
        label: "Asset Repair",
      },
    });

    renderPage();

    expect(
      screen.getByRole("region", { name: "Already reported" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("This asset already has an open fault report.")
    ).toBeInTheDocument();
  });

  describe("Cancel destination", () => {
    it("falls back to the asset overview when there is no referer", () => {
      // `getRefererPath()` returns null on direct navigation, bookmarks and a
      // restrictive Referrer-Policy — the common case, not the edge case.
      renderPage({ referer: null });

      expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
        "href",
        "/assets/asset-1/overview"
      );
    });

    it("returns to a filtered list when the referer carries a query string", () => {
      renderPage({ referer: "/assets?search=xlr" });

      expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
        "href",
        "/assets?search=xlr"
      );
    });

    it("never links back to this page when the referer is self-referential", () => {
      renderPage({ referer: "/assets/asset-1/report-fault" });

      expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
        "href",
        "/assets/asset-1/overview"
      );
    });
  });

  describe("branches with no form", () => {
    it("states a CAPABILITY, not a policy, for a quantity-tracked asset", () => {
      renderPage({ isQuantityTracked: true });

      expect(
        screen.getByText(
          "Fault reports are recorded against individually-tracked assets."
        )
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("What's wrong?")).not.toBeInTheDocument();
    });

    it("replaces the form when the asset already has an open fault", () => {
      renderPage({ hasOpenRepair: true });

      expect(
        screen.getByRole("region", {
          name: "This item already has an open fault report",
        })
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("What's wrong?")).not.toBeInTheDocument();
    });
  });

  it("disables the submit while the form is posting", () => {
    routerMocks.useNavigation.mockReturnValue({ state: "submitting" });

    renderPage();

    expect(screen.getByRole("button", { name: "Reporting…" })).toBeDisabled();
  });
});
