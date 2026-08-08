import { config } from "~/config/shelf.config";

/**
 * Appends the application name to a route's meta title.
 *
 * Used by ~325 route `meta` exports, none of which should hardcode the app
 * name — `config.appName` is the single source of truth (US-001 AC6).
 *
 * `config` is a plain client-safe object (it already ships to the browser via
 * `~/components/marketing/logos.tsx`), so importing it here pulls no
 * `*.server` module into the client bundle. Keep it that way — see
 * `.claude/rules/no-server-module-in-route-client-exports.md`.
 *
 * @param title - The page-specific title. `null`/`undefined` renders "Not found".
 * @returns e.g. `"Assets | HCF Production Stock"`.
 */
export const appendToMetaTitle = (title: string | null | undefined) =>
  `${title ? title : "Not found"} | ${config.appName}`;
