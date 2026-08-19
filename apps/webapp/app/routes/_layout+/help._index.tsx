/**
 * Route — the Help Centre index.
 *
 * Search across every guide and FAQ, then the guides grouped by how people
 * think about them. Everything is filtered to what the reader can actually
 * reach, so nobody is taught a screen their role hides.
 *
 * Renders entirely from static content plus the layout loader's data, so there
 * is no loader here and nothing server-side is imported — see
 * `.claude/rules/no-server-module-in-route-client-exports.md`.
 *
 * @see {@link file://./../../modules/help/content.ts}
 */

import type { ChangeEvent } from "react";
import { useMemo, useState } from "react";
import { ChevronRightIcon, LifeBuoyIcon, SearchIcon } from "lucide-react";
import { Link } from "react-router";
import Input from "~/components/forms/input";
import { useHelpAudience } from "~/hooks/use-help-audience";
import type { HelpGroup, HelpTopic } from "~/modules/help/content";
import {
  HELP_GROUP_LABELS,
  helpTopicsFor,
  searchHelp,
} from "~/modules/help/content";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta = () => [{ title: appendToMetaTitle("Help") }];

/** The order groups appear in on the index. */
const GROUP_ORDER: HelpGroup[] = ["start", "everyday", "managing"];

export default function HelpIndexPage() {
  const audience = useHelpAudience();
  const [query, setQuery] = useState("");

  const topics = useMemo(() => helpTopicsFor(audience), [audience]);
  const results = useMemo(() => searchHelp(query, audience), [query, audience]);
  const isSearching = query.trim().length > 0;

  const byGroup = useMemo(() => {
    const map = new Map<HelpGroup, HelpTopic[]>();
    for (const topic of topics) {
      const list = map.get(topic.group) ?? [];
      list.push(topic);
      map.set(topic.group, list);
    }
    return map;
  }, [topics]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-6 md:py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
          Help
        </h1>
        <p className="mt-2 text-base text-gray-600">
          Guides for every part of the system, written for how the production
          team actually uses it. You only see the parts your role can reach.
        </p>
      </div>

      <div className="relative mb-8">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400"
        />
        <Input
          label="Search help"
          hideLabel
          name="help-search"
          value={query}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setQuery(event.currentTarget.value)
          }
          placeholder="e.g. overdue booking, print labels, report a fault"
          inputClassName="pl-9"
          autoComplete="off"
        />
      </div>

      {isSearching ? (
        <SearchResults
          topics={results.topics}
          faqCount={results.faqs.length}
          query={query}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {GROUP_ORDER.map((group) => {
            const list = byGroup.get(group) ?? [];
            if (list.length === 0) return null;
            return (
              <section key={group}>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-900">
                  {HELP_GROUP_LABELS[group]}
                </h2>
                <div className="flex flex-col gap-3">
                  {list.map((topic) => (
                    <TopicCard key={topic.id} topic={topic} />
                  ))}
                </div>
              </section>
            );
          })}

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-900">
              Questions
            </h2>
            <Link
              to="/help/faqs"
              className="flex items-center gap-4 rounded border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:bg-gray-50"
            >
              <LifeBuoyIcon
                aria-hidden
                className="size-5 shrink-0 text-primary-600"
              />
              <span className="flex-1">
                <span className="block text-sm font-semibold text-gray-900">
                  FAQs
                </span>
                <span className="block text-sm text-gray-600">
                  Short answers to the things people ask most.
                </span>
              </span>
              <ChevronRightIcon
                aria-hidden
                className="size-4 shrink-0 text-gray-400"
              />
            </Link>
          </section>

          <section className="rounded border border-gray-200 bg-gray-50 p-4">
            <h2 className="text-sm font-semibold text-gray-900">
              Still stuck?
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-600">
              Use the Questions/Feedback link at the bottom of the sidebar, or
              ask an administrator — anything to do with your access, your role
              or the workspace settings is theirs to change.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

/** One guide, as a tappable card. */
function TopicCard({ topic }: { topic: HelpTopic }) {
  return (
    <Link
      to={`/help/${topic.id}`}
      className="flex items-center gap-4 rounded border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:bg-gray-50"
    >
      <span className="flex-1">
        <span className="block text-sm font-semibold text-gray-900">
          {topic.title}
        </span>
        <span className="block text-sm text-gray-600">{topic.summary}</span>
      </span>
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-gray-400" />
    </Link>
  );
}

/** Matching guides, plus a pointer into the FAQs when questions matched too. */
function SearchResults({
  topics,
  faqCount,
  query,
}: {
  topics: HelpTopic[];
  faqCount: number;
  query: string;
}) {
  if (topics.length === 0 && faqCount === 0) {
    return (
      <div className="rounded border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-gray-900">
          Nothing found for &ldquo;{query.trim()}&rdquo;
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-gray-600">
          Try a different word — the guides use plain wording like
          &ldquo;booking&rdquo;, &ldquo;custody&rdquo;, &ldquo;fault&rdquo; or
          &ldquo;label&rdquo;.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {topics.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-900">
            {topics.length} {topics.length === 1 ? "guide" : "guides"}
          </h2>
          <div className="flex flex-col gap-3">
            {topics.map((topic) => (
              <TopicCard key={topic.id} topic={topic} />
            ))}
          </div>
        </section>
      ) : null}

      {faqCount > 0 ? (
        <Link
          to="/help/faqs"
          className="flex items-center gap-4 rounded border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:bg-gray-50"
        >
          <LifeBuoyIcon
            aria-hidden
            className="size-5 shrink-0 text-primary-600"
          />
          <span className="flex-1">
            <span className="block text-sm font-semibold text-gray-900">
              {faqCount} matching {faqCount === 1 ? "question" : "questions"}
            </span>
            <span className="block text-sm text-gray-600">
              Open the FAQs and search there to read the answers.
            </span>
          </span>
          <ChevronRightIcon
            aria-hidden
            className="size-4 shrink-0 text-gray-400"
          />
        </Link>
      ) : null}
    </div>
  );
}
