/**
 * Booking Fault Warning Email — to a booking's people (US-011).
 *
 * A cable breaks on Tuesday. It is on Sunday's booking. US-002 already stops it
 * being checked out — but silently, and not until Sunday, when the person
 * holding the scanner is standing in the building with no spare. US-002
 * protects the data; **this email protects the person** (`DECISIONS.md` #26).
 *
 * Audience is deliberately narrow (#18, #54, #55): the booking's **custodian**
 * and its **per-booking notification recipients**, minus the reporter (#66).
 * The org's leads are NOT in this audience — they get US-009's email about the
 * same fault, from a different template.
 *
 * One email per BOOKING, never per booked row: a faulty asset can match a
 * standalone row and several kit-driven rows on the same booking, and fanning
 * out per row would send the custodian the same warning three times.
 *
 * @see {@link file://./../modules/asset-repair/notifications.server.ts} — the fan-out
 * @see {@link file://./asset-fault-reported.tsx} — the leads' sibling email
 */

import {
  Button,
  Container,
  Head,
  Html,
  render,
  Text,
} from "@react-email/components";

import { SERVER_URL } from "~/utils/env";
import { LogoForEmail } from "./logo";
import { styles } from "./styles";

/** Props required to render the booking fault warning. */
export interface BookingAssetFaultWarningProps {
  /** Recipient's first name for the greeting; falls back to "there". */
  recipientFirstName: string | null;
  /** Display title of the asset that was reported faulty. */
  assetTitle: string;
  /**
   * The fault as typed by the reporter.
   *
   * **User-controlled free text**, interpolated as a JSX child so React escapes
   * it for the HTML context. See the sibling template for why the Markdoc
   * sanitisation rule does not cover this surface.
   */
  faultDescription: string;
  /** The affected booking's name. */
  bookingName: string;
  /** Booking id, for the CTA link. */
  bookingId: string;
  /**
   * The booking's window, pre-formatted by the caller.
   *
   * Formatted upstream rather than here because each recipient carries their
   * own date/time/timezone preferences on the already-loaded row — formatting
   * in the template would either ignore them or force a per-recipient fetch.
   */
  bookingPeriod: string;
  /**
   * Which message this is (US-008 AC12).
   *
   * `"reported"` — a fault was reported; the item MAY come back (US-011).
   * `"written-off"` — it is NOT coming back; find a replacement.
   *
   * Materially different wording is a requirement rather than a nicety: a
   * second warning that reads like the first teaches people to ignore both,
   * which costs you the one that mattered.
   */
  variant?: "reported" | "written-off";
}

/**
 * React Email component for the booking fault warning.
 *
 * @param props - See {@link BookingAssetFaultWarningProps}
 */
function BookingAssetFaultWarningTemplate({
  recipientFirstName,
  assetTitle,
  faultDescription,
  bookingName,
  bookingId,
  bookingPeriod,
  variant = "reported",
}: BookingAssetFaultWarningProps) {
  const isWrittenOff = variant === "written-off";
  return (
    <Html>
      <Head>
        <title>An item on your booking is out of action</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.h2 }}>
            {isWrittenOff
              ? "An item on your booking has been written off"
              : "An item on your booking is out of action"}
          </Text>

          <Text style={{ ...styles.p }}>
            Hey {recipientFirstName ?? "there"},
          </Text>

          <Text style={{ ...styles.p }}>
            {isWrittenOff ? (
              <>
                <strong>{assetTitle}</strong> has been written off as beyond
                repair. It's on your booking <strong>{bookingName}</strong> (
                {bookingPeriod}).
              </>
            ) : (
              <>
                <strong>{assetTitle}</strong> has been reported faulty, and it's
                on your booking <strong>{bookingName}</strong> ({bookingPeriod}
                ).
              </>
            )}
          </Text>

          <Text
            style={{
              ...styles.p,
              backgroundColor: "#FFF8E1",
              border: "1px solid #FFE082",
              borderRadius: "8px",
              padding: "16px",
              fontStyle: "italic",
            }}
          >
            “{faultDescription}”
          </Text>

          {/*
            The point of the email: it tells them now, while there is still time
            to find a replacement, rather than at check-out when there isn't.
          */}
          <Text style={{ ...styles.p }}>
            {isWrittenOff
              ? "It isn't coming back, so you'll need to find a replacement for this booking."
              : "It can't be checked out until the repair is marked complete, so you'll want to arrange a replacement before then."}
          </Text>

          <Button
            href={`${SERVER_URL}/bookings/${bookingId}`}
            style={{
              ...styles.button,
              textAlign: "center" as const,
              maxWidth: "220px",
              marginBottom: "24px",
            }}
          >
            View booking
          </Button>

          <Text style={{ marginTop: "24px", ...styles.p }}>
            HCF Production Team
          </Text>
        </div>
      </Container>
    </Html>
  );
}

/**
 * Renders the booking fault warning as an HTML string.
 *
 * @param props - See {@link BookingAssetFaultWarningProps}
 * @returns The rendered HTML
 */
export const bookingAssetFaultWarningHtml = (
  props: BookingAssetFaultWarningProps
) => render(<BookingAssetFaultWarningTemplate {...props} />);

/**
 * Plain-text version of the booking fault warning.
 *
 * @param props - See {@link BookingAssetFaultWarningProps}
 * @returns The plain-text body
 */
export const bookingAssetFaultWarningText = ({
  recipientFirstName,
  assetTitle,
  faultDescription,
  bookingName,
  bookingId,
  bookingPeriod,
  variant = "reported",
}: BookingAssetFaultWarningProps) =>
  variant === "written-off"
    ? `An item on your booking has been written off

Hey ${recipientFirstName ?? "there"},

${assetTitle} has been written off as beyond repair. It's on your booking ${bookingName} (${bookingPeriod}).

"${faultDescription}"

It isn't coming back, so you'll need to find a replacement for this booking.

View booking: ${SERVER_URL}/bookings/${bookingId}

HCF Production Team`
    : `An item on your booking is out of action

Hey ${recipientFirstName ?? "there"},

${assetTitle} has been reported faulty, and it's on your booking ${bookingName} (${bookingPeriod}).

"${faultDescription}"

It can't be checked out until the repair is marked complete, so you'll want to arrange a replacement before then.

View booking: ${SERVER_URL}/bookings/${bookingId}

HCF Production Team`;
