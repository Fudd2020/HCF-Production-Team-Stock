import type { Booking } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AvailabilityLabel,
  getKitAvailabilityStatus,
} from "~/components/booking/availability-label";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.overview.manage-assets";
import { hasAssetBookingConflicts } from "~/modules/booking/helpers";
import { useLoaderData } from "react-router";

// why: controlling booking loader data to test availability label for different booking scenarios
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");

  return {
    ...actual,
    useLoaderData: vi.fn(),
    Link: ({ children, to, ...props }: any) => (
      <a href={typeof to === "string" ? to : ""} {...props}>
        {children}
      </a>
    ),
  };
});

// why: testing availability label tooltip display without executing booking conflict detection logic
vi.mock("~/modules/booking/helpers", () => ({
  hasAssetBookingConflicts: vi.fn(),
}));

const useLoaderDataMock = vi.mocked(useLoaderData);
const hasAssetBookingConflictsMock = vi.mocked(hasAssetBookingConflicts);

function createAsset(
  overrides: Partial<AssetWithBooking> = {}
): AssetWithBooking {
  return {
    id: "asset-1",
    name: "Camera",
    description: null,
    imageId: null,
    kitId: null,
    custody: null,
    categoryId: "category-1",
    organizationId: "org-1",
    locationId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    barcode: null,
    availableToBook: true,
    requireLabelOnCheckout: false,
    bookingAssets: [],
    tags: [],
    qrCodes: [],
    qrScanned: "",
    ...overrides,
  } as AssetWithBooking;
}

describe("AvailabilityLabel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLoaderDataMock.mockReturnValue({
      booking: {
        id: "current-booking",
        name: "Current Booking",
        status: BookingStatus.RESERVED,
      } as Booking,
    });
    hasAssetBookingConflictsMock.mockReturnValue(true);
  });

  it("shows the newest conflicting booking in the tooltip", async () => {
    const asset = createAsset({
      bookingAssets: [
        {
          booking: {
            id: "old-booking",
            name: "Old Booking",
            status: BookingStatus.RESERVED,
            from: new Date("2024-01-01T10:00:00Z"),
            to: new Date("2024-01-02T10:00:00Z"),
          },
        } as any,
        {
          booking: {
            id: "new-booking",
            name: "New Booking",
            status: BookingStatus.ONGOING,
            from: new Date("2024-02-01T10:00:00Z"),
            to: new Date("2024-02-02T10:00:00Z"),
          },
        } as any,
      ],
    });

    render(
      <AvailabilityLabel
        asset={asset}
        isCheckedOut={false}
        isAlreadyAdded={false}
      />
    );

    const user = userEvent.setup();
    await user.hover(await screen.findByText("Already booked"));

    const links = await screen.findAllByRole("link", {
      name: "New Booking",
    });
    expect(
      links.some(
        (link) => link.getAttribute("href") === "/bookings/new-booking"
      )
    ).toBe(true);
  });

  it("skips the current booking when selecting the conflicting booking", async () => {
    const asset = createAsset({
      bookingAssets: [
        {
          booking: {
            id: "current-booking",
            name: "Current Booking",
            status: BookingStatus.ONGOING,
            from: new Date("2024-03-01T10:00:00Z"),
            to: new Date("2024-03-02T10:00:00Z"),
          },
        } as any,
        {
          booking: {
            id: "other-booking",
            name: "Other Booking",
            status: BookingStatus.OVERDUE,
            from: new Date("2024-02-01T10:00:00Z"),
            to: new Date("2024-02-02T10:00:00Z"),
          },
        } as any,
      ],
    });

    render(
      <AvailabilityLabel
        asset={asset}
        isCheckedOut={false}
        isAlreadyAdded={false}
      />
    );

    const user = userEvent.setup();
    await user.hover(await screen.findByText("Already booked"));

    const links = await screen.findAllByRole("link", {
      name: "Other Booking",
    });
    expect(
      links.some(
        (link) => link.getAttribute("href") === "/bookings/other-booking"
      )
    ).toBe(true);
  });
});

/**
 * US-006 AC5 — the kit picker must not lead someone into the AC4 refusal.
 *
 * `getKitAvailabilityStatus` is what the picker's `setDisabledBulkItems` effect
 * reads, so `isKitUnavailable` IS the disabling decision. The subtlety worth
 * pinning is which signals belong in it: an open repair is enforced by the
 * server (`updateBookingAssets` refuses it), whereas `availableToBook` is only
 * a client-side hint the backend does not check. Disabling on the latter would
 * block an add the server would have accepted.
 */
describe("getKitAvailabilityStatus — member out of action", () => {
  /** A kit membership row as the picker's loader selects it. */
  function createKit(
    members: Array<{
      repairs?: Array<{ id: string }>;
      availableToBook?: boolean;
    }>
  ) {
    return {
      id: "kit-1",
      status: "AVAILABLE",
      assetKits: members.map((member, index) => ({
        id: `ak-${index}`,
        asset: {
          id: `asset-${index}`,
          type: "INDIVIDUAL",
          status: "AVAILABLE",
          availableToBook: member.availableToBook ?? true,
          repairs: member.repairs ?? [],
          custody: null,
          bookingAssets: [],
        },
      })),
    } as unknown as Parameters<typeof getKitAvailabilityStatus>[0];
  }

  beforeEach(() => {
    hasAssetBookingConflictsMock.mockReturnValue(false);
  });

  it("marks a kit with a broken member unavailable, so the picker disables it", () => {
    const status = getKitAvailabilityStatus(
      createKit([{}, { repairs: [{ id: "repair-1" }] }, {}]),
      "booking-1"
    );

    expect(status.someMemberOutOfAction).toBe(true);
    // The load-bearing assertion: this is what `setDisabledBulkItems` reads.
    expect(status.isKitUnavailable).toBe(true);
  });

  it("leaves a fully healthy kit selectable", () => {
    // AC3 — nothing changes for a kit with no faults.
    const status = getKitAvailabilityStatus(
      createKit([{}, {}, {}]),
      "booking-1"
    );

    expect(status.someMemberOutOfAction).toBe(false);
    expect(status.isKitUnavailable).toBe(false);
  });

  it("does NOT disable a kit merely marked unavailable to book", () => {
    /**
     * The asymmetry, stated as a test. `availableToBook` is a hint the server
     * does not enforce, so disabling on it would refuse an add the backend
     * would accept — a stricter client than server, which is its own bug.
     * The kit still reports the fact so the badge can show it.
     */
    const status = getKitAvailabilityStatus(
      createKit([{ availableToBook: false }, {}]),
      "booking-1"
    );

    expect(status.someAssetMarkedUnavailable).toBe(true);
    expect(status.someMemberOutOfAction).toBe(false);
    expect(status.isKitUnavailable).toBe(false);
  });

  it("does not treat an empty kit as having a broken member", () => {
    // An empty kit is already unavailable for its own reason
    // (`isKitWithoutAssets`); it must not also claim a fault that isn't there.
    const status = getKitAvailabilityStatus(createKit([]), "booking-1");

    expect(status.someMemberOutOfAction).toBe(false);
    expect(status.isKitWithoutAssets).toBe(true);
  });
});
