import { Link, useMatches, Outlet } from "react-router";
import { ErrorContent } from "~/components/errors";
import { ShelfSymbolLogo } from "~/components/marketing/logos";
import SubHeading from "~/components/shared/sub-heading";
import { config } from "~/config/shelf.config";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const loader = () => null;

export const meta = () => [{ title: appendToMetaTitle("Authentication") }];

export default function App() {
  const matches = useMatches();
  /** Find the title and subHeading from current route */
  const data = matches[matches.length - 1].data as {
    title?: string;
    subHeading?: string;
  };
  const { title, subHeading } = data;
  const { logoPath } = config;

  return (
    <main className="flex h-screen">
      <div className="flex size-full flex-col items-center justify-center p-6 lg:p-10">
        <div className=" mb-8 text-center">
          <Link to="/" reloadDocument>
            <ShelfSymbolLogo />
          </Link>

          <h1>{title}</h1>
          {subHeading && (
            <SubHeading className="max-w-md">{subHeading}</SubHeading>
          )}
        </div>
        <div className=" w-[360px]">
          <Outlet />
        </div>
        {/*
          AGPL-3.0 §13 attribution, signed-out copy. The signed-in offer lives
          in the sidebar user menu; this covers people who never sign in.
          LEGALLY REQUIRED — do not remove in a "strip Shelf references" sweep.
          "Based on" is accurate attribution and implies no endorsement.
        */}
        <p className="mt-8 text-xs text-gray-500">
          Based on Shelf.nu · AGPL-3.0 ·{" "}
          <a
            href={config.sourceRepositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700"
            aria-label="Source code — opens the source repository on GitHub in a new tab"
          >
            Source code
          </a>
        </p>
      </div>
      {/*
        Brand cover panel. `hidden … lg:flex` — it is never rendered on a phone
        or portrait tablet, which is what the HCF team actually uses, so it is
        deliberately a flat panel rather than a photo-sourcing exercise.

        why: a photograph is "option B" in design.md and is structured to be a
        pure asset swap: render the image element below as the first child, add
        the scrim div after it, and give the panel `relative` (it already is).

            <img
              className="absolute inset-0 size-full max-w-none object-cover"
              src="/static/images/<hcf-cover>.webp"
              alt=""
            />
            <div className="absolute inset-0 bg-[#26282E]/60" aria-hidden="true" />

        The scrim is not optional — it is what keeps the white lockup above the
        3:1 floor on an arbitrary photograph.
      */}
      <aside className="relative hidden h-full flex-col items-start justify-start bg-[#26282E] p-8 pt-[20vh] lg:flex lg:w-[700px] xl:w-[900px]">
        {logoPath?.fullLogoInverse ? (
          <img
            src={logoPath.fullLogoInverse}
            /* why: the ONLY `alt=""` in this feature. The same lockup is
               already announced by ShelfSymbolLogo above the form on this very
               page; announcing it twice is what US-002 AC8 forbids. Do not
               copy this pattern to other logo surfaces. */
            alt=""
            className="relative z-20 h-auto w-[320px] max-w-[70%]"
          />
        ) : null}
        <p className="relative z-20 mt-6 max-w-[40ch] text-sm text-white/80">
          Equipment tracking for the HCF production team.
        </p>
      </aside>
    </main>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
