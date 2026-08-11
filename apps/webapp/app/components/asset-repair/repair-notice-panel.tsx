/**
 * Repair Notice Panel
 *
 * The statement-of-fact panel used by every equipment-repairs surface that has
 * to tell the user something they cannot argue with:
 *
 * - the report-fault form's consequence warning (`danger`, not dismissible)
 * - the asset's "out of action" panel (`danger`, not dismissible)
 * - the post-report confirmation (`success`, dismissible)
 * - the written-off panel (`neutral`, US-008)
 * - the degraded-kit panel (`danger`, US-006)
 *
 * **Why not `InfoBox` / `WarningBox`:** both hard-code a dismiss button, and a
 * fact the user must not be able to dismiss ("this item cannot be booked") is
 * the wrong job for a dismissible box. `InfoBox` additionally renders
 * `text-blue-500` on `bg-blue-50`, which is below WCAG AA. See `design.md` §12.
 *
 * **Accessibility contract** (`design.md` §12, §13):
 * - The heading carries the meaning; the tone colour is never the only signal.
 * - Icons are `aria-hidden` — the heading already says what the icon says.
 * - `success` is `role="status"` (polite). The other tones are
 *   `role="region"` + `aria-labelledby`; `role="alert"` would interrupt a
 *   screen reader on every page load, and this panel is present on load.
 * - Body-text contrast: danger 6.05:1, success 5.13:1, neutral 10.4:1.
 *   Heading is `text-gray-900` in every tone (16.3:1 on `bg-error-50`).
 *
 * @see {@link file://./../../../../../Requirements/equipment-repairs/design.md}
 */

import type { ReactNode } from "react";
import { useId } from "react";
import { Ban, CircleCheck, TriangleAlert, XIcon } from "lucide-react";
import { tw } from "~/utils/tw";

/** Visual + semantic tone of the panel. */
type RepairNoticeTone = "danger" | "success" | "neutral";

type RepairNoticePanelProps = {
  /**
   * `danger` — something is wrong and the item is unusable.
   * `success` — a confirmation the user should be able to dismiss.
   * `neutral` — settled and finished (written off); nobody needs to act.
   */
  tone: RepairNoticeTone;
  /** Panel heading. Also the accessible name of the region. */
  title: string;
  /** Panel body. Prose, links and lists are all fine. */
  children: ReactNode;
  /**
   * Renders a dismiss button. Defaults to `false` — a statement of fact is not
   * dismissible, and the out-of-action panel in particular must persist.
   */
  dismissible?: boolean;
  /** Called when the dismiss button is pressed. Required by `dismissible`. */
  onDismiss?: () => void;
  /** Buttons rendered bottom-right, below the body. */
  actions?: ReactNode;
  className?: string;
};

/** Per-tone container classes. Colours come from the Tailwind theme, no hex. */
const toneClasses: Record<RepairNoticeTone, string> = {
  danger: "border-error-300 bg-error-50 text-error-700",
  success: "border-success-300 bg-success-50 text-success-700",
  neutral: "border-gray-300 bg-gray-50 text-gray-700",
};

/** Per-tone decorative icon. Always `aria-hidden` — the heading carries meaning. */
const toneIcons: Record<RepairNoticeTone, typeof TriangleAlert> = {
  danger: TriangleAlert,
  success: CircleCheck,
  neutral: Ban,
};

/**
 * A bordered notice panel stating a repair-related fact.
 *
 * @param props - See {@link RepairNoticePanelProps}
 * @returns The rendered panel
 */
export function RepairNoticePanel({
  tone,
  title,
  children,
  dismissible = false,
  onDismiss,
  actions,
  className,
}: RepairNoticePanelProps) {
  const headingId = useId();
  const Icon = toneIcons[tone];

  return (
    <section
      // `success` announces politely when it appears after a redirect.
      // The persistent tones are landmarks, not announcements.
      role={tone === "success" ? "status" : "region"}
      aria-labelledby={headingId}
      className={tw(
        "flex items-start gap-3 rounded border px-4 py-3 text-sm",
        toneClasses[tone],
        className
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />

      <div className="min-w-0 flex-1">
        <h3 id={headingId} className="text-sm font-semibold text-gray-900">
          {title}
        </h3>
        <div className="mt-1 space-y-1">{children}</div>
        {actions ? (
          <div className="mt-3 flex flex-wrap justify-end gap-2">{actions}</div>
        ) : null}
      </div>

      {dismissible ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 shrink-0 rounded p-1 text-gray-500 hover:bg-white/60 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      ) : null}
    </section>
  );
}
