import { config } from "~/config/shelf.config";
import { SERVER_URL, SUPPORT_EMAIL } from "~/utils/env";
import { resolveUserDisplayName } from "~/utils/user";
import type { InviteWithInviterAndOrg } from "./types";

export function generateRandomCode(length: number): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters.charAt(randomIndex);
  }
  return code;
}

export const inviteEmailText = ({
  invite,
  token,
  extraMessage,
}: {
  invite: InviteWithInviterAndOrg;
  token: string;
  extraMessage?: string | null;
}) => `Hi,

${resolveUserDisplayName(invite.inviter)} has invited you to join ${
  invite.organization.name
} on ${config.appName} — the system HCF uses to keep track of its production
equipment.
${
  extraMessage
    ? `
---
Message from ${resolveUserDisplayName(invite.inviter)}:

${extraMessage}
---
`
    : ""
}
Click the link to accept the invite:
${SERVER_URL}/accept-invite/${invite.id}?token=${token}

Once your account is set up you'll be able to see what equipment we have, where it is, and book what you need for a service or event.

It works on your phone. After you sign in, open your browser's share or menu button and choose "Add to Home Screen" — then it's one tap away when you're setting up.

If something doesn't work, or you're not sure what to do, email ${SUPPORT_EMAIL} and someone on the production team will help.
${
  invite.organization.customEmailFooter
    ? `\n---\n${invite.organization.customEmailFooter}`
    : ""
}
Thanks,
HCF Production Team
`;

export function splitName(fullName?: string | null): {
  firstName: string;
  lastName: string;
} {
  const trimmed = (fullName ?? "").trim();
  const spaceIndex = trimmed.indexOf(" ");

  if (spaceIndex === -1) {
    return { firstName: trimmed, lastName: "" };
  }

  return {
    firstName: trimmed.slice(0, spaceIndex),
    lastName: trimmed.slice(spaceIndex + 1).trim(),
  };
}

export const revokeAccessEmailText = ({
  orgName,
  customEmailFooter,
}: {
  orgName: string;
  customEmailFooter?: string | null;
}) => `Hi,

Your access to ${orgName} has been revoked.

If you think this is a mistake, please contact the organization's administrator.
${customEmailFooter ? `\n---\n${customEmailFooter}` : ""}
Thanks,
HCF Production Team
`;

export const roleChangeEmailText = ({
  orgName,
  previousRole,
  newRole,
  customEmailFooter,
}: {
  orgName: string;
  previousRole: string;
  newRole: string;
  customEmailFooter?: string | null;
}) => `Hi,

Your role in ${orgName} has been changed from ${previousRole} to ${newRole}.

If you think this is a mistake, please contact the workspace administrator. If something doesn't work, or you're not sure what to do, email ${SUPPORT_EMAIL} and someone on the production team will help.
${customEmailFooter ? `\n---\n${customEmailFooter}` : ""}
Thanks,
HCF Production Team
`;
