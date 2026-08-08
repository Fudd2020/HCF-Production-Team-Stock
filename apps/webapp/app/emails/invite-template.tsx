import {
  Button,
  Html,
  Text,
  Head,
  render,
  Container,
  Section,
} from "@react-email/components";
import { config } from "~/config/shelf.config";
import type { InviteWithInviterAndOrg } from "~/modules/invite/types";
import { SERVER_URL, SUPPORT_EMAIL } from "~/utils/env";
import { resolveUserDisplayName } from "~/utils/user";
import { CustomEmailFooter } from "./components/custom-footer";
import { LogoForEmail } from "./logo";
import { styles } from "./styles";

interface Props {
  invite: InviteWithInviterAndOrg;
  token: string;
  extraMessage?: string | null;
}

export function InvitationEmailTemplate({
  invite,
  token,
  extraMessage,
}: Props) {
  const { emailPrimaryColor } = config;
  return (
    <Html>
      <Head>
        <title>{`Invitation to join ${config.appName}`}</title>
      </Head>

      <Container
        style={{ padding: "32px 16px", maxWidth: "600px", margin: "0 auto" }}
      >
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ marginBottom: "24px", ...styles.p }}>
            Hi,
            <br />
            {resolveUserDisplayName(invite.inviter)} has invited you to join{" "}
            {invite.organization.name} on {config.appName} — the system HCF uses
            to keep track of its production equipment.
            <br />
            <br />
            Click the button below to accept:
          </Text>

          {extraMessage ? (
            <Section
              style={{
                padding: "16px",
                borderRadius: "8px",
                border: "1px solid #E5E7EB",
                backgroundColor: "#F9FAFB",
                marginBottom: "24px",
              }}
            >
              <Text
                style={{
                  fontSize: "14px",
                  fontWeight: "600",
                  color: "#6B7280",
                  margin: "0 0 8px 0",
                }}
              >
                Message from {resolveUserDisplayName(invite.inviter)}:
              </Text>

              <Text
                style={{
                  fontSize: "15px",
                  color: "#111827",
                  margin: "0px",
                  whiteSpace: "pre-wrap",
                  lineHeight: "1.5",
                }}
              >
                {extraMessage}
              </Text>
            </Section>
          ) : null}

          <Button
            href={`${SERVER_URL}/accept-invite/${invite.id}?token=${token}`}
            style={{ ...styles.button, textAlign: "center" }}
          >
            Accept the invite
          </Button>
          <Text style={{ ...styles.p, marginBottom: "24px" }}>
            Once your account is set up you'll be able to see what equipment we
            have, where it is, and book what you need for a service or event.
          </Text>

          {/* why: the "add to home screen" nudge lives here rather than in the
              app shell — the sidebar card that used to carry it was desktop-only
              (and never rendered), while this email is read on the phone that
              needs the shortcut, before the account even exists. See design.md,
              "Routed decision 2". */}
          <Text style={{ ...styles.p, marginBottom: "24px" }}>
            It works on your phone. After you sign in, open your browser's share
            or menu button and choose "Add to Home Screen" — then it's one tap
            away when you're setting up.
          </Text>

          <Text style={{ ...styles.p, marginBottom: "24px" }}>
            If something doesn't work, or you're not sure what to do, email{" "}
            {SUPPORT_EMAIL} and someone on the production team will help.
          </Text>

          <Text style={{ marginBottom: "32px", ...styles.p }}>
            Thanks, <br />
            HCF Production Team
          </Text>

          <CustomEmailFooter
            footerText={invite.organization.customEmailFooter}
          />

          <Text style={{ fontSize: "14px", color: "#344054" }}>
            This message was sent automatically by {config.appName} to{" "}
            <span style={{ color: emailPrimaryColor }}>
              {invite.inviteeEmail}
            </span>
            .
          </Text>
        </div>
      </Container>
    </Html>
  );
}

/*
 *The HTML content of an email will be accessed by a server file to send email,
  we cannot import a TSX component in a server file so we are exporting TSX converted to HTML string using render function by react-email.
 */
export const invitationTemplateString = ({
  token,
  invite,
  extraMessage,
}: Props) =>
  render(
    <InvitationEmailTemplate
      token={token}
      invite={invite}
      extraMessage={extraMessage}
    />
  );
