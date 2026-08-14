/**
 * Route (layout) — Repairs (US-003).
 *
 * The parent of `/repairs`, mirroring the `reminders.tsx` / `reminders._index.tsx`
 * pair the story names as the precedent for a top-level "what is outstanding"
 * index. It holds the breadcrumb, the title and the error boundary; every read
 * — and the permission check that gates it — lives in the child index loader,
 * so this file deliberately loads nothing.
 *
 * ⚠️ **Do not move the permission check up here.** `requirePermission` in
 * `repairs._index.tsx` is the enforcement for US-003 AC8 (`SELF_SERVICE` is
 * refused); a layout that also checked it would run the same query twice per
 * navigation and would still not protect a future sibling child route.
 *
 * There is no `$param` in this route's path, so `DECISIONS.md` #184's
 * `$assetId_` escaping trap does not apply — but note that any future
 * `repairs.$something.tsx` sharing this layout WILL nest inside it.
 *
 * @see {@link file://./repairs._index.tsx}
 * @see {@link file://./reminders.tsx} the shape this copies
 */

import { Link, Outlet } from "react-router";
import { ErrorContent } from "~/components/errors";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta = () => [{ title: appendToMetaTitle("Repairs") }];

/**
 * Deliberately empty — the child index owns the data and the permission gate.
 *
 * @returns `null`
 */
export function loader() {
  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/repairs">Repairs</Link>,
};

/**
 * Renders the matched child route.
 *
 * The screen itself (`design.md` §9) is `shelf-frontend-dev`'s and lives in the
 * index route; this is the shell only.
 */
export default function RepairsPage() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
