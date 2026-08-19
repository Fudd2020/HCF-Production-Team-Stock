/**
 * Route — the Help Centre FAQs.
 *
 * A searchable accordion, grouped by the guide each question belongs to so a
 * reader who wants the fuller explanation is one click away. Filtered by what
 * the reader can reach, like every other part of the Help Centre.
 *
 * Static content only — no loader, and nothing server-side is imported, per
 * `.claude/rules/no-server-module-in-route-client-exports.md`.
 *
 * @see {@link file://./../../modules/help/content.ts}
 */

import type { ChangeEvent } from "react";
import { useMemo, useState } from "react";
import { ArrowLeftIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { Link } from "react-router";
import Input from "~/components/forms/input";
import { useHelpAudience } from "~/hooks/use-help-audience";
import type { HelpFaq, HelpTopicId } from "~/modules/help/content";
import { getHelpTopic, helpFaqsFor } from "~/modules/help/content";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { tw } from "~/utils/tw";

export const meta = () => [{ title: appendToMetaTitle("FAQs") }];

/** Heading used for questions that belong to no single guide. */
const GENERAL = "General";

export default function HelpFaqsPage() {
  const audience = useHelpAudience();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const faqs = useMemo(() => helpFaqsFor(audience), [audience]);

  const visible = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return faqs;
    return faqs.filter((faq) => {
      const haystack = `${faq.question} ${faq.answer}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [faqs, query]);

  // Group by guide, keeping the order the questions were written in.
  const groups = useMemo(() => {
    const map = new Map<string, { topicId?: HelpTopicId; items: HelpFaq[] }>();
    for (const faq of visible) {
      const label = faq.topic
        ? getHelpTopic(faq.topic)?.title ?? GENERAL
        : GENERAL;
      const entry = map.get(label) ?? { topicId: faq.topic, items: [] };
      entry.items.push(faq);
      map.set(label, entry);
    }
    return [...map.entries()];
  }, [visible]);

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
        FAQs
      </h1>
      <p className="mt-2 text-base text-gray-600">
        Tap a question to see the answer.
      </p>

      <div className="relative my-6">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400"
        />
        <Input
          label="Search questions"
          hideLabel
          name="faq-search"
          value={query}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setQuery(event.currentTarget.value)
          }
          placeholder="e.g. overdue, custody, camera"
          inputClassName="pl-9"
          autoComplete="off"
        />
      </div>

      {visible.length === 0 ? (
        <div className="rounded border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-gray-900">
            No matching questions
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">
            Try a different word, or browse the guides from the Help screen.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(([label, group]) => (
            <section key={label}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-900">
                {group.topicId ? (
                  <Link
                    to={`/help/${group.topicId}`}
                    className="hover:text-primary-600"
                  >
                    {label}
                  </Link>
                ) : (
                  label
                )}
              </h2>
              <div className="flex flex-col gap-3">
                {group.items.map((faq) => (
                  <FaqRow
                    key={faq.id}
                    faq={faq}
                    open={openId === faq.id}
                    onToggle={() =>
                      setOpenId(openId === faq.id ? null : faq.id)
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** One question, expanding to reveal its answer. */
function FaqRow({
  faq,
  open,
  onToggle,
}: {
  faq: HelpFaq;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded border border-gray-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <span className="flex-1 text-sm font-semibold text-gray-900">
          {faq.question}
        </span>
        <ChevronDownIcon
          aria-hidden
          className={tw(
            "mt-0.5 size-4 shrink-0 text-gray-400 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open ? (
        <p className="px-4 pb-4 text-sm leading-relaxed text-gray-600">
          {faq.answer}
        </p>
      ) : null}
    </div>
  );
}
