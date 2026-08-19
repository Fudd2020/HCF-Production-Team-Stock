/**
 * Renders a Help Centre guide's body.
 *
 * One `switch` over `HelpBlock["kind"]` and nothing else — every guide is data
 * in `~/modules/help/content`, so adding a topic never touches this file.
 * Adding a new *kind* of block does, and the switch is exhaustive so the
 * compiler will say so.
 *
 * Styling follows the house conventions in `.claude/rules/reports-styling.md`:
 * plain Tailwind scale, `rounded border border-gray-200 bg-white` cards, and
 * no hardcoded pixel font sizes.
 *
 * @see {@link file://./../../modules/help/content.ts}
 */

import { AlertCircleIcon, LightbulbIcon } from "lucide-react";
import type { HelpBlock } from "~/modules/help/content";
import { tw } from "~/utils/tw";

/**
 * Draws one block.
 *
 * @param block - The block to render
 */
export function HelpBlockView({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case "heading":
      return (
        <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-gray-900">
          {block.text}
        </h2>
      );

    case "text":
      return (
        <p className="text-base leading-relaxed text-gray-700">{block.text}</p>
      );

    case "steps":
      return (
        <ol className="flex flex-col gap-3 rounded border border-gray-200 bg-white p-4 md:p-6">
          {block.items.map((item, index) => (
            <li key={item} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-semibold tabular-nums text-primary-700">
                {index + 1}
              </span>
              <span className="text-sm leading-relaxed text-gray-700">
                {item}
              </span>
            </li>
          ))}
        </ol>
      );

    case "bullets":
      return (
        <ul className="flex flex-col gap-2 rounded border border-gray-200 bg-white p-4 md:p-6">
          {block.items.map((item) => (
            <li key={item} className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-2 size-1.5 shrink-0 rounded-full bg-primary-500"
              />
              <span className="text-sm leading-relaxed text-gray-700">
                {item}
              </span>
            </li>
          ))}
        </ul>
      );

    case "definitions":
      return (
        <dl className="divide-y divide-gray-100 rounded border border-gray-200 bg-white">
          {block.items.map((item) => (
            <div key={item.term} className="px-4 py-3 md:px-6">
              <dt className="text-sm font-semibold text-gray-900">
                {item.term}
              </dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-gray-600">
                {item.detail}
              </dd>
            </div>
          ))}
        </dl>
      );

    case "tip":
      return <HelpNote tone="tip">{block.text}</HelpNote>;

    case "warning":
      return <HelpNote tone="warning">{block.text}</HelpNote>;
  }
}

/** A highlighted aside — a "worth knowing" tip, or a caution. */
function HelpNote({
  tone,
  children,
}: {
  tone: "tip" | "warning";
  children: string;
}) {
  const isWarning = tone === "warning";
  const Icon = isWarning ? AlertCircleIcon : LightbulbIcon;

  return (
    <div
      className={tw(
        "flex items-start gap-3 rounded border p-4",
        isWarning
          ? "border-warning-200 bg-warning-25"
          : "border-gray-200 bg-gray-50"
      )}
    >
      <Icon
        aria-hidden
        className={tw(
          "mt-0.5 size-4 shrink-0",
          isWarning ? "text-warning-600" : "text-primary-600"
        )}
      />
      <p className="text-sm leading-relaxed text-gray-700">{children}</p>
    </div>
  );
}
