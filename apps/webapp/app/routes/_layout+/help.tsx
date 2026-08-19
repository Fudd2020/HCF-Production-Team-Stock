/**
 * Route (layout) — the Help Centre.
 *
 * Parent of `/help`, `/help/faqs` and `/help/<topic>`, mirroring the
 * `repairs.tsx` / `repairs._index.tsx` pair. It owns the breadcrumb, the meta
 * title and the error boundary, and deliberately loads nothing: the guides are
 * static content in `~/modules/help/content`, and the only gate is the
 * authenticated `_layout` this sits inside.
 *
 * @see {@link file://./help._index.tsx}
 * @see {@link file://./../../modules/help/content.ts}
 */

import { Link, Outlet } from "react-router";
import { ErrorContent } from "~/components/errors";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta = () => [{ title: appendToMetaTitle("Help") }];

/**
 * Deliberately empty — the guides are static, and every child renders from
 * content the client already has.
 *
 * @returns `null`
 */
export function loader() {
  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/help">Help</Link>,
};

export default function HelpPage() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
