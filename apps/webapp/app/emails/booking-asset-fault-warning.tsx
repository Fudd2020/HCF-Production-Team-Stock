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
  variant?: BookingAssetFaultVariant;
}

/** The three messages this template carries. */
type BookingAssetFaultVariant = "reported" | "written-off" | "reinstated";

/**
 * Per-variant copy, in one table rather than ternaries at six call sites.
 *
 * A third variant made the nested-ternary form unreadable, and — worse — made
 * it easy to update the heading for a variant without updating its body. One
 * row per message keeps each one whole and reviewable as a unit.
 *
 * `quoteTone` matters: `"warning"` is the yellow box the two bad-news variants
 * use. Reinstating is good news, so it gets a neutral box — a yellow alert
 * around "it's back" reads as though something is still wrong.
 */
const VARIANT_COPY: Record<
  BookingAssetFaultVariant,
  {
    heading: string;
    /**
     * The sentence BETWEEN the asset title and the booking name.
     *
     * Stored as the middle fragment rather than a whole sentence so the HTML
     * and plain-text renderers share one string while HTML can still bold the
     * two names — the full sentence is
     * `<assetTitle><afterAsset><bookingName> (<period>).`
     */
    afterAsset: string;
    /** Introduces the quoted fault text. */
    quoteIntro: string | null;
    /** What the reader should DO. The reason the email exists. */
    action: string;
    quoteTone: "warning" | "neutral";
  }
> = {
  reported: {
    heading: "An item on your booking is out of action",
    afterAsset: " has been reported faulty, and it's on your booking ",
    quoteIntro: null,
    action:
      "It can't be checked out until the repair is marked complete, so you'll want to arrange a replacement before then.",
    quoteTone: "warning",
  },
  "written-off": {
    heading: "An item on your booking has been written off",
    afterAsset: " has been written off as beyond repair. It's on your booking ",
    quoteIntro: null,
    action:
      "It isn't coming back, so you'll need to find a replacement for this booking.",
    quoteTone: "warning",
  },
  reinstated: {
    heading: "An item on your booking is back in service",
    afterAsset: " has been brought back into service. It's on your booking ",
    // The other two quote a fault that is current. Here it is history, and
    // saying so is what stops the quote reading as a fresh problem.
    quoteIntro: "It had been written off after this was reported:",
    action:
      "It's bookable again, so if you arranged a replacement you can stand it down.",
    quoteTone: "neutral",
  },
};

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
  const copy = VARIANT_COPY[variant];
  return (
    <Html>
      <Head>
        <title>{copy.heading}</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.h2 }}>{copy.heading}</Text>

          <Text style={{ ...styles.p }}>
            Hey {recipientFirstName ?? "there"},
          </Text>

          {/*
            `assetTitle` and `bookingName` are user-controlled. They are JSX
            CHILDREN here, which React Email escapes — never interpolated into
            raw HTML (`DECISIONS.md`'s US-011 escaping contract).
          */}
          <Text style={{ ...styles.p }}>
            <strong>{assetTitle}</strong>
            {copy.afterAsset}
            <strong>{bookingName}</strong>
            {` (${bookingPeriod}).`}
          </Text>

          {copy.quoteIntro ? (
            <Text style={{ ...styles.p }}>{copy.quoteIntro}</Text>
          ) : null}

          <Text
            style={{
              ...styles.p,
              // Neutral for the good-news variant: a yellow alert box around
              // "it's back" reads as though something is still wrong.
              backgroundColor:
                copy.quoteTone === "warning" ? "#FFF8E1" : "#F5F5F5",
              border:
                copy.quoteTone === "warning"
                  ? "1px solid #FFE082"
                  : "1px solid #E0E0E0",
              borderRadius: "8px",
              padding: "16px",
              fontStyle: "italic",
            }}
          >
            “{faultDescription}”
          </Text>

          {/*
            The point of the email. For the two warnings: it tells them while
            there is still time to find a replacement, rather than at check-out
            when there isn't. For the reinstate: it tells them they can stand
            that replacement down.
          */}
          <Text style={{ ...styles.p }}>{copy.action}</Text>

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
}: BookingAssetFaultWarningProps) => {
  /**
   * Built from the SAME {@link VARIANT_COPY} row the HTML renders, rather than
   * a parallel set of template literals. The previous fork kept a full copy of
   * every sentence per variant, which is how an HTML body and a plain-text body
   * end up saying different things after one of them is edited.
   */
  const copy = VARIANT_COPY[variant];
  const quoteIntro = copy.quoteIntro ? `${copy.quoteIntro}\n\n` : "";

  return `${copy.heading}

Hey ${recipientFirstName ?? "there"},

${assetTitle}${copy.afterAsset}${bookingName} (${bookingPeriod}).

${quoteIntro}"${faultDescription}"

${copy.action}

View booking: ${SERVER_URL}/bookings/${bookingId}

HCF Production Team`;
};
