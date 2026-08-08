/**
 * Application logo components.
 *
 * The single chokepoint for every logo surface in the app shell: the sidebar
 * (expanded and collapsed), the mobile header, the auth/welcome pages and the
 * `/qr/:id` landing page. All four read their artwork from
 * `config.logoPath` and their accessible name from `config.appName`, so a
 * rebrand is a config change rather than a sweep of call sites.
 *
 * There is deliberately **no** artwork fallback: `logoPath` is set in
 * `shelf.config.ts` and the previous fallback branches rendered Shelf's own
 * symbol and typography, which US-001 AC7 / US-002 AC7 forbid from being
 * reachable at all. `Config.logoPath` remains optional in the type, so the
 * reads below are optional-chained; if a deployment ever unsets it the browser
 * renders the `alt` text (the app name), which is the specified degradation —
 * not Shelf artwork.
 *
 * @see {@link file://../../config/shelf.config.ts}
 */
import { config } from "~/config/shelf.config";
import { tw } from "~/utils/tw";

/**
 * Logo shown in the sidebar header.
 *
 * Renders the square symbol when the sidebar is collapsed to its 48px rail and
 * the full lockup when it is expanded. The lockup sets **height only** so the
 * browser preserves the source aspect ratio (US-002 AC1) — never add a width.
 *
 * @param props.minimized - Whether the sidebar is collapsed to the icon rail.
 */
export const ShelfSidebarLogo = ({ minimized }: { minimized: boolean }) => {
  const { logoPath, appName } = config;

  return minimized ? (
    <img
      src={logoPath?.symbol}
      alt={appName}
      className="mx-1.5 inline h-[32px] transition duration-150 ease-linear"
    />
  ) : (
    // why: 40px (not 32px) per TL-1 — the lockup renders ~207x40 inside the
    // ~228px of content width a 16rem sidebar leaves, so it fits at its true
    // ratio and is legible. Height-only sizing keeps the ratio exact.
    <img
      src={logoPath?.fullLogo}
      alt={appName}
      className="mx-1.5 inline h-[40px] transition duration-150 ease-linear"
    />
  );
};

/**
 * Logo shown in the header on viewports narrower than `md`.
 *
 * Fills the height of its 32px slot; width follows the aspect ratio.
 */
export const ShelfMobileLogo = () => {
  const { logoPath, appName } = config;

  return <img src={logoPath?.fullLogo} alt={appName} className="h-full" />;
};

/**
 * Square symbol mark — auth pages, welcome screens, SSO screens.
 *
 * @param props.className - Extra classes merged over the default `size-12`.
 */
export const ShelfSymbolLogo = ({ className }: { className?: string }) => {
  const { logoPath, appName } = config;
  const classes = tw("mx-auto mb-2 size-12", className);

  return <img src={logoPath?.symbol} alt={appName} className={classes} />;
};

/**
 * Full wide lockup — the `/qr/:id` landing page header.
 *
 * @param props.className - Classes controlling the rendered size. Set height
 *   only; a width would break the aspect ratio (US-002 AC1).
 */
export const ShelfFullLogo = ({ className }: { className?: string }) => {
  const { logoPath, appName } = config;
  const classes = tw(className);

  return <img src={logoPath?.fullLogo} alt={appName} className={classes} />;
};
