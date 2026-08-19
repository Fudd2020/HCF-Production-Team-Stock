/**
 * Contextual help — explanation that sits next to the thing it explains.
 *
 * Two shapes, both optionally deep-linking into the fuller guide so the inline
 * copy can stay to a sentence:
 *
 *  - `HelpHint` — a quiet one-liner under a screen's heading.
 *  - `HelpCallout` — a card, for an empty state or a rule that isn't guessable.
 *
 * Prefer a hint. A screen covered in callouts teaches nobody anything.
 *
 * @see {@link file://./../../modules/help/content.ts} — the guides
 */

import type { ReactNode } from "react";
import { HelpCircleIcon } from "lucide-react";
import { Link } from "react-router";
import type { HelpTopicId } from "~/modules/help/content";
import { tw } from "~/utils/tw";

type WithTopic = {
  /** The guide this points at. Omit for a hint that needs no further reading. */
  topic?: HelpTopicId;
  /** Overrides the default wording on the deep link. */
  linkLabel?: string;
};

/**
 * A quiet one-line explanation for the top of a screen or a form section.
 *
 * @param children - The hint text
 * @param topic - Optional guide to link to
 * @param linkLabel - Optional wording for that link
 * @param className - Extra classes for spacing at the call site
 */
export function HelpHint({
  children,
  topic,
  linkLabel = "Learn more",
  className,
}: WithTopic & { children: ReactNode; className?: string }) {
  return (
    <p className={tw("text-sm leading-relaxed text-gray-500", className)}>
      {children}{" "}
      {topic ? (
        <Link
          to={`/help/${topic}`}
          className="font-medium text-primary-600 underline-offset-2 hover:underline"
        >
          {linkLabel}
        </Link>
      ) : null}
    </p>
  );
}

/**
 * A card-sized piece of help, for an empty state or a rule worth a paragraph.
 *
 * @param title - Optional bold lead-in
 * @param children - The body
 * @param topic - Optional guide to link to
 * @param linkLabel - Optional wording for that link
 * @param className - Extra classes for spacing at the call site
 */
export function HelpCallout({
  title,
  children,
  topic,
  linkLabel = "Read the guide",
  className,
}: WithTopic & { title?: string; children: ReactNode; className?: string }) {
  return (
    <div
      className={tw(
        "flex items-start gap-3 rounded border border-gray-200 bg-gray-50 p-4",
        className
      )}
    >
      <HelpCircleIcon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-primary-600"
      />
      <div className="flex flex-col gap-1">
        {title ? (
          <span className="text-sm font-semibold text-gray-900">{title}</span>
        ) : null}
        <div className="text-sm leading-relaxed text-gray-600">{children}</div>
        {topic ? (
          <Link
            to={`/help/${topic}`}
            className="text-sm font-semibold text-primary-600 underline-offset-2 hover:underline"
          >
            {linkLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
