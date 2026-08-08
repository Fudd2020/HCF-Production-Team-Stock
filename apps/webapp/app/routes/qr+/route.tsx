import { Link, Outlet } from "react-router";
import { ErrorContent } from "~/components/errors";
import { ShelfFullLogo } from "~/components/marketing/logos";
import { usePosition } from "~/hooks/use-position";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta = () => [{ title: appendToMetaTitle("QR codes") }];

export default function QR() {
  usePosition();
  return (
    <div className="container h-full min-h-screen px-4 py-12">
      <div className="flex h-full flex-col justify-center text-center">
        {/* why: no `title` attribute — the logo's alt text is already the
            link's accessible name (US-002 AC8). */}
        <Link
          to="/"
          className="logo mx-auto inline-block h-[32px]"
          reloadDocument
        >
          <ShelfFullLogo className="h-full" />
        </Link>

        <Outlet />
      </div>
    </div>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
