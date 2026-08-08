/**
 * "Why you received this" footers for booking notification emails.
 *
 * why: each of the three footers below used to end with a
 * "© <year> Shelf.nu" line. Those are deliberately deleted rather than
 * rebranded — HCF asserts no copyright over this software, and the AGPL-3.0
 * source offer lives in the app (US-008), not in every email. Same rule as
 * `audit-updates-template.tsx`. See design.md, "Global email rules".
 *
 * @see {@link file://../bookings-updates-template.tsx}
 */
import { Text } from "@react-email/components";
import type { BookingForEmail } from "../types";

/** Footer used when sending normal user emails */
export const UserFooter = ({ booking }: { booking: BookingForEmail }) => (
  <>
    <Text style={{ fontSize: "14px", color: "#344054" }}>
      This email was sent to {booking.custodianUser!.email} because it is part
      of the workspace{" "}
      <span style={{ color: "#101828", fontWeight: "600" }}>
        "{booking.organization.name}"
      </span>
      . <br /> If you think you weren’t supposed to have received this email
      please contact the owner ({booking.organization.owner.email}) of the
      workspace.
    </Text>
  </>
);

/** Footer used when sending admin user emails */
export const AdminFooter = ({ booking }: { booking: BookingForEmail }) => (
  <>
    <Text style={{ fontSize: "14px", color: "#344054" }}>
      This email was sent to you because you are the OWNER or ADMIN of the
      workspace{" "}
      <span style={{ color: "#101828", fontWeight: "600" }}>
        "{booking.organization.name}"
      </span>
      . <br /> If you think you weren’t supposed to have received this email
      please contact support.
    </Text>
  </>
);

/**
 * Footer that provides contextual "why you received this" messaging
 * in booking notification emails.
 *
 * The `reason` parameter maps directly to the `NotificationRecipient.reason`
 * field resolved by `getBookingNotificationRecipients()`:
 *   - `"custodian"` — "you are the custodian of this booking"
 *   - `"creator"` — "you created this booking"
 *   - `"admin"` — "you are an admin of the workspace"
 *   - `"always_notify"` — "you are set to always receive booking notifications"
 *   - `"booking_recipient"` — "you were added as a notification recipient"
 *
 * Falls back to a generic message for any unrecognized reason value,
 * providing forward compatibility if new reason types are added.
 *
 * @param booking - Used to display workspace name and owner contact email
 * @param recipientEmail - Shown in the footer so the user knows which
 *   address received the email
 * @param reason - The notification recipient reason string
 */
export const NotificationReasonFooter = ({
  booking,
  recipientEmail,
  reason,
}: {
  booking: BookingForEmail;
  recipientEmail: string;
  reason: string;
}) => {
  const reasonTexts: Record<string, string> = {
    custodian: "you are the custodian of this booking",
    creator: "you created this booking",
    admin: `you are an admin of the workspace "${booking.organization.name}"`,
    always_notify: `you are set to always receive booking notifications in "${booking.organization.name}"`,
    booking_recipient:
      "you were added as a notification recipient for this booking",
  };

  const reasonText =
    reasonTexts[reason] || "you are associated with this booking";

  return (
    <>
      <Text style={{ fontSize: "14px", color: "#344054" }}>
        This email was sent to {recipientEmail} because {reasonText}. <br /> If
        you think you weren’t supposed to have received this email please
        contact the owner ({booking.organization.owner.email}) of the workspace.
      </Text>
    </>
  );
};
