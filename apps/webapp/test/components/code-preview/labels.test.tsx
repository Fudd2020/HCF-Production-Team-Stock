/**
 * Printed-label branding tests (US-007 AC1, AC2, AC3, AC8).
 *
 * `QrLabel` and `BarcodeLabel` are the ONLY components that render a printable
 * label — the single-asset preview, the code-preview dialog and the bulk QR
 * download all render through them — so asserting the absence here covers the
 * bulk path too (AC3).
 *
 * These assertions used to check that a "Powered by shelf.nu" footer appeared
 * by default and could be switched off. Both components have had that footer
 * and its `showShelfBranding` prop removed outright: a workspace setting could
 * not satisfy AC8, because the prop defaulted to `true`, so an existing
 * organisation would have kept printing Shelf-branded labels.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// why: lottie-react pulls in canvas APIs Happy DOM does not implement; the
// label components never render an animation.
vi.mock("lottie-react", () => ({
  default: () => null,
}));

import { BarcodeLabel, QrLabel } from "~/components/code-preview/code-preview";

describe("QrLabel", () => {
  const baseProps = {
    title: "Camera",
    data: {
      qr: {
        id: "qr-123",
        src: "data:image/png;base64,AAA",
        size: "small",
      },
    },
  } as const;

  it("renders no Shelf branding", () => {
    render(<QrLabel {...baseProps} />);

    expect(screen.queryByText(/Powered by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/shelf/i)).not.toBeInTheDocument();
  });

  it("still shows the asset title and the code id", () => {
    render(<QrLabel {...baseProps} />);

    expect(screen.getByText("Camera")).toBeInTheDocument();
    expect(screen.getByText("qr-123")).toBeInTheDocument();
  });

  it("names no vendor in the QR image's alt text", () => {
    render(<QrLabel {...baseProps} />);

    expect(screen.getByRole("img")).toHaveAttribute("alt", "small-qr-code.png");
  });
});

describe("BarcodeLabel", () => {
  const baseProps = {
    title: "Camera",
    data: {
      type: "EAN13",
      value: "1234567890123",
    },
  } as const;

  it("renders no Shelf branding", () => {
    render(<BarcodeLabel {...baseProps} />);

    expect(screen.queryByText(/Powered by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/shelf/i)).not.toBeInTheDocument();
  });

  it("still shows the asset title and the barcode value", () => {
    render(<BarcodeLabel {...baseProps} />);

    expect(screen.getByText("Camera")).toBeInTheDocument();
    expect(screen.getByText("1234567890123")).toBeInTheDocument();
  });
});
