/**
 * Plain-text onboarding email, sent once when a user finishes onboarding and
 * `SEND_ONBOARDING_EMAIL` is enabled.
 *
 * why: this file previously held a signed personal letter from one of Shelf's
 * co-founders ("I'm Carlos Virreira… Greetings from The Netherlands… Shelf
 * Asset Management, Inc."). There was nothing in it to rebrand — a signed
 * letter from a named person at another company cannot be re-attributed — so
 * the copy was replaced outright rather than edited (US-004 AC4/AC5,
 * design.md "The onboarding email").
 *
 * There is deliberately no HTML counterpart: this template has always been
 * text-only and US-004 is not a licence to restructure templates.
 *
 * @see {@link file://../routes/_welcome+/onboarding.tsx} — the only caller
 */
import { config } from "~/config/shelf.config";
import { SUPPORT_EMAIL } from "~/utils/env";

/**
 * Builds the plain-text body of the onboarding email.
 *
 * @param args.firstName - The recipient's first name, used in the greeting.
 * @returns The full email body as plain text.
 */
export const onboardingEmailText = ({
  firstName,
}: {
  firstName: string;
}) => `Hi ${firstName},

Your account on ${config.appName} is ready.

This is where we keep track of the church's production equipment — what we
have, where it is, and who has it booked. If you're setting up for a service,
you can check what's available before you get there.

On your phone, open your browser's share or menu button and choose
"Add to Home Screen" so it's one tap away.

Anything not working, or not sure where to start? Email ${SUPPORT_EMAIL}.

Thanks,
HCF Production Team
`;
