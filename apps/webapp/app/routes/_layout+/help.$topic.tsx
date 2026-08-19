/**
 * Route — a single Help Centre guide.
 *
 * A dumb renderer: it looks the topic up by its route parameter, resolves its
 * blocks for the reader, and hands each one to `HelpBlockView`. Every word
 * lives in `~/modules/help/content`, so a guide change never touches this file.
 *
 * Static content only — no loader, and nothing server-side is imported, per
 * `.claude/rules/no-server-module-in-route-client-exports.md`.
 *
 * @see {@link file://./../../modules/help/content.ts}
 */

import { useMemo } from "react";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { Link, useParams } from "react-router";
import { HelpBlockView } from "~/components/help/help-blocks";
import { Button } from "~/components/shared/button";
import { useHelpAudience } from "~/hooks/use-help-audience";
import { getHelpTopic, helpBlocksFor } from "~/modules/help/content";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta = () => [{ title: appendToMetaTitle("Help guide") }];

export default function HelpTopicPage() {
  const { topic: topicId } = useParams();
  const audience = useHelpAudience();

  const topic = getHelpTopic(topicId);
  const blocks = useMemo(
    () => (topic ? helpBlocksFor(topic, audience) : []),
    [topic, audience]
  );

  // An unknown id, or a guide this reader shouldn't be sent to (a stale link,
  // or their role changed since it was shared). Say so rather than 404-ing.
  if (!topic || !topic.visibleTo(audience)) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-12">
        <div className="rounded border border-gray-200 bg-white p-6">
          <h1 className="text-base font-semibold text-gray-900">
            That guide isn&apos;t available
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">
            It may have moved, or it covers a part of the system your role
            doesn&apos;t use.
          </p>
          <Button to="/help" variant="secondary" className="mt-4">
            Back to Help
          </Button>
        </div>
      </div>
    );
  }

  const related = (topic.related ?? [])
    .map((id) => getHelpTopic(id))
    .filter((item): item is NonNullable<typeof item> =>
      Boolean(item?.visibleTo(audience))
    );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-12">
      <Link
        to="/help"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        All guides
      </Link>

      <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
        {topic.title}
      </h1>
      <p className="mt-2 text-base text-gray-600">{topic.summary}</p>

      {topic.featurePath ? (
        <Button to={topic.featurePath} variant="secondary" className="mt-4">
          Open {topic.title}
        </Button>
      ) : null}

      <div className="mt-8 flex flex-col gap-4">
        {blocks.map((block, index) => (
          <HelpBlockView key={`${block.kind}-${index}`} block={block} />
        ))}
      </div>

      {related.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-900">
            Related guides
          </h2>
          <div className="flex flex-col gap-3">
            {related.map((item) => (
              <Link
                key={item.id}
                to={`/help/${item.id}`}
                className="flex items-center gap-4 rounded border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:bg-gray-50"
              >
                <span className="flex-1 text-sm font-semibold text-gray-900">
                  {item.title}
                </span>
                <ChevronRightIcon
                  aria-hidden
                  className="size-4 shrink-0 text-gray-400"
                />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
