/**
 * Fault Reported Email — to the organisation's leads (US-009).
 *
 * Sent immediately when a fault report commits, to every `OWNER` and `ADMIN`
 * except the reporter (`DECISIONS.md` #13, #68). Not a digest: Neil chose
 * immediate delivery knowing that pack-down after a service can produce six
 * reports in ten minutes, because the alternative is leads finding out only by
 * remembering to check a list.
 *
 * Follows the house template established in `stripe/audit-trial-welcome.tsx` —
 * `LogoForEmail`, shared `styles`, a personalised greeting, a CTA `Button`
 * rather than a bare link, and both HTML and plain-text exports.
 *
 * @see {@link file://./../modules/asset-repair/notifications.server.ts} — the fan-out
 * @see {@link file://./low-stock-alert.tsx} — the closest existing sibling
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

/** Props required to render the fault-reported email. */
export interface AssetFaultReportedProps {
  /** Recipient's first name for the greeting; falls back to "there". */
  recipientFirstName: string | null;
  /** Display title of the asset that was reported faulty. */
  assetTitle: string;
  /**
   * The fault as typed by the reporter.
   *
   * **User-controlled free text.** It is interpolated as a JSX child, so React
   * escapes it for the HTML context — do not switch this to
   * `dangerouslySetInnerHTML` or build the markup by string concatenation.
   * Note that `.claude/rules/sanitize-note-content-markdoc.md` governs Markdoc
   * NOTE rendering, which is a different surface: it does not cover this one.
   */
  faultDescription: string;
  /** Who reported it, already resolved to a display name. */
  reporterName: string;
  /** Asset id, for the CTA link. */
  assetId: string;
  /** Organisation name, for context when someone is in several workspaces. */
  organizationName: string;
}

/**
 * React Email component for the leads' fault notification.
 *
 * @param props - See {@link AssetFaultReportedProps}
 */
function AssetFaultReportedTemplate({
  recipientFirstName,
  assetTitle,
  faultDescription,
  reporterName,
  assetId,
  organizationName,
}: AssetFaultReportedProps) {
  return (
    <Html>
      <Head>
        <title>Fault reported</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.h2 }}>Fault reported</Text>

          <Text style={{ ...styles.p }}>
            Hey {recipientFirstName ?? "there"},
          </Text>

          <Text style={{ ...styles.p }}>
            <strong>{reporterName}</strong> reported a fault on{" "}
            <strong>{assetTitle}</strong> in {organizationName}.
          </Text>

          {/*
            The fault text in a quoted block. Rendered as a JSX child, so React
            escapes it — see the prop's doc.
          */}
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

          <Text style={{ ...styles.p }}>
            It's out of action and can't be booked or checked out until the
            repair is marked complete.
          </Text>

          <Button
            href={`${SERVER_URL}/assets/${assetId}/overview`}
            style={{
              ...styles.button,
              textAlign: "center" as const,
              maxWidth: "200px",
              marginBottom: "24px",
            }}
          >
            View item
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
 * Renders the fault-reported email as an HTML string.
 *
 * @param props - See {@link AssetFaultReportedProps}
 * @returns The rendered HTML
 */
export const assetFaultReportedHtml = (props: AssetFaultReportedProps) =>
  render(<AssetFaultReportedTemplate {...props} />);

/**
 * Plain-text version of the fault-reported email.
 *
 * @param props - See {@link AssetFaultReportedProps}
 * @returns The plain-text body
 */
export const assetFaultReportedText = ({
  recipientFirstName,
  assetTitle,
  faultDescription,
  reporterName,
  assetId,
  organizationName,
}: AssetFaultReportedProps) => `Fault reported

Hey ${recipientFirstName ?? "there"},

${reporterName} reported a fault on ${assetTitle} in ${organizationName}.

"${faultDescription}"

It's out of action and can't be booked or checked out until the repair is marked complete.

View item: ${SERVER_URL}/assets/${assetId}/overview

HCF Production Team`;
