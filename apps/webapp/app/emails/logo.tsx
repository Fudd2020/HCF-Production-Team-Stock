/**
 * Logo block rendered at the top of every transactional email.
 *
 * The artwork and the accessible name both come from `~/config/shelf.config`,
 * so rebranding the app rebrands the emails with it. Historically this file
 * hardcoded Shelf's own artwork while *reading* `config.logoPath` two lines
 * later to decide whether to print the word "shelf" — which meant setting
 * `logoPath` rebranded every logo in the product **except** the one in emails
 * (US-004 / TL-5). Do not reintroduce a literal `src` here.
 *
 * The `src` is absolute (`SERVER_URL` prefixed) because mail clients render the
 * message outside our origin — a relative path resolves to nothing (US-004
 * AC3). `Config.logoPath` is optional in the type, so the read is
 * optional-chained; when it is unset the client shows the `alt` text, which is
 * the app name. There is deliberately **no** artwork fallback: the previous one
 * rendered Shelf's own logo and wordmark.
 *
 * @see {@link file://../config/shelf.config.ts}
 * @see {@link file://./styles.ts}
 */
import { Img } from "@react-email/components";
import { config } from "~/config/shelf.config";
import { SERVER_URL } from "~/utils/env";

/**
 * Renders the application logo for use inside an email template.
 *
 * @returns The logo image, sized to a 32px height with its width left to the
 *   source aspect ratio.
 */
export function LogoForEmail() {
  const { logoPath, appName } = config;

  return (
    <div style={{ margin: "0 auto", display: "flex" }}>
      <Img
        src={logoPath?.fullLogo ? `${SERVER_URL}${logoPath.fullLogo}` : ""}
        alt={appName}
        width="auto"
        height="32"
        style={{ marginRight: "6px", width: "auto", height: "32px" }}
      />
    </div>
  );
}
