/**
 * Asset Repair — Zod schemas.
 *
 * Deliberately NOT a `*.server` module: the report-fault form binds these with
 * `useZorm` on the client, and the route action parses the same schema on the
 * server. One definition, so a client-side pass can never disagree with the
 * server (`CLAUDE.md` § Form Validation Pattern).
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./../../routes/_layout+/assets.$assetId_.report-fault.tsx}
 * @see {@link file://./../../routes/_layout+/assets.$assetId.repairs.$repairId.close.tsx}
 * @see {@link file://./../../routes/_layout+/repairs._index.tsx}
 */

import { z } from "zod";

/**
 * Maximum length of a fault description.
 *
 * Mirrored by the textarea's `maxLength` so the client stops the user before
 * the server has to. A length limit is NOT a security control — the description
 * is sanitised for Markdoc delimiters at write time regardless
 * (`.claude/rules/sanitize-note-content-markdoc.md`).
 */
export const FAULT_DESCRIPTION_MAX_LENGTH = 1000;

/**
 * Payload for `POST /assets/:assetId/report-fault` (US-001 AC2).
 *
 * `.trim()` runs BEFORE `.min(1)`, so a whitespace-only description is rejected
 * rather than stored as an empty fault report.
 */
export const reportFaultSchema = z.object({
  faultDescription: z
    .string()
    .trim()
    .min(1, "Describe the fault")
    .max(
      FAULT_DESCRIPTION_MAX_LENGTH,
      `Keep the description under ${FAULT_DESCRIPTION_MAX_LENGTH.toLocaleString(
        "en-GB"
      )} characters.`
    ),
});

/** Parsed, validated report-fault payload. */
export type ReportFaultPayload = z.infer<typeof reportFaultSchema>;

/**
 * Maximum length of the optional "what was done" note captured at closure.
 *
 * Same value and same reasoning as {@link FAULT_DESCRIPTION_MAX_LENGTH}: the
 * textarea mirrors it so the client stops the user first, and it is NOT a
 * security control — the note is stripped of Markdoc delimiters at write time
 * regardless (`.claude/rules/sanitize-note-content-markdoc.md`, US-005 AC10).
 */
export const RESOLUTION_NOTE_MAX_LENGTH = 1000;

/**
 * Payload for `POST /assets/:assetId/repairs/:repairId/close` (US-005).
 *
 * The note is genuinely optional — closing a repair with no explanation is a
 * supported outcome (`design.md` §8, "What was done? (optional)"). An empty or
 * whitespace-only textarea must therefore become `undefined`, not `""`: the
 * service writes the value straight to `AssetRepair.resolutionNote`, and an
 * empty string there would render as a note that says nothing while looking
 * like one was left.
 */
export const closeRepairSchema = z.object({
  resolutionNote: z
    .string()
    .trim()
    .max(
      RESOLUTION_NOTE_MAX_LENGTH,
      `Keep the note under ${RESOLUTION_NOTE_MAX_LENGTH.toLocaleString(
        "en-GB"
      )} characters.`
    )
    .optional()
    // `.trim()` runs first, so this collapses "   " to `undefined` as well.
    .transform((value) => (value ? value : undefined)),
});

/** Parsed, validated close-repair payload. */
export type CloseRepairPayload = z.infer<typeof closeRepairSchema>;

/**
 * The three buckets of `/repairs` (`DECISIONS.md` #39, `design.md` D3).
 *
 * All three are subsets of "open" — every bucket is `closedAt IS NULL` and
 * nothing else decides bookability (`DECISIONS.md` #31, #52). A repair that has
 * been closed or reinstated therefore leaves the list automatically, whichever
 * bucket is showing.
 *
 * ⚠️ **`written-off` is legitimately empty today, and that is not a bug.** The
 * `outcome` column arrives with US-008; until then no repair can be written off
 * (`DECISIONS.md` #30, #37). The parameter ships anyway so US-008 changes one
 * `where` fragment instead of rewriting this loader *and* the screen that
 * consumes it.
 */
export const REPAIR_LIST_FILTERS = ["awaiting", "written-off", "all"] as const;

/** A `/repairs` bucket. */
export type RepairListFilter = (typeof REPAIR_LIST_FILTERS)[number];

/** The bucket shown when `?filter=` is absent or unparseable. */
export const DEFAULT_REPAIR_LIST_FILTER: RepairListFilter = "awaiting";

/**
 * The `?filter=` search param.
 *
 * Deliberately NOT used with `parseData` on the route: an unknown value must
 * **degrade to `awaiting`, never 400 or 500** (US-003 "invalid input" edge
 * case, `design.md` §9 "Invalid `filter` value"). The user cannot see this
 * param, so an error page for a typo in a shared URL is a dead end. Use
 * {@link parseRepairListFilter}.
 */
export const repairListFilterSchema = z.enum(REPAIR_LIST_FILTERS);

/**
 * Reads the `?filter=` param, degrading anything unrecognised to the default.
 *
 * Lives here rather than in a `*.server` module because the bucket switcher
 * (`design.md` §9) needs the same values and the same default on the client —
 * one definition, so the active tab can never disagree with the rows below it.
 *
 * @param value - The raw `filter` search param (`null` when absent)
 * @returns A valid bucket; `"awaiting"` for absent, empty or unknown values
 */
export function parseRepairListFilter(
  value: string | null | undefined
): RepairListFilter {
  const parsed = repairListFilterSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_REPAIR_LIST_FILTER;
}

/**
 * Maximum length of a bench diagnosis (US-008 AC1).
 *
 * Same reasoning as the fault description: a client-side stop, not a security
 * control. The diagnosis is sanitised for Markdoc delimiters at write time
 * regardless (`.claude/rules/sanitize-note-content-markdoc.md`).
 */
export const DIAGNOSIS_MAX_LENGTH = 1000;

/**
 * The OPEN stages a lead may move a repair to (US-008 AC2a).
 *
 * ⚠️ **`fixed` is deliberately absent, and so is `written off`.** "Fixed" is the
 * consequence of US-005's close — one action, "mark repaired" — and nothing may
 * reach it without that compare-and-set (#25 as amended by #38). Writing off is
 * its own intent below, because it is terminal and permanent (#36) and must not
 * be reachable from a stage dropdown by a mis-click.
 */
export const repairStageSchema = z.enum(["REPORTED", "DIAGNOSED", "IN_REPAIR"]);

/**
 * Payload for a stage transition (US-008 AC2).
 *
 * The diagnosis is optional and, when omitted, leaves any previously recorded
 * one untouched — an empty box must not blank a colleague's bench notes.
 */
export const transitionRepairSchema = z.object({
  intent: z.literal("transition"),
  toStatus: repairStageSchema,
  diagnosis: z
    .string()
    .trim()
    .max(
      DIAGNOSIS_MAX_LENGTH,
      `Keep the diagnosis under ${DIAGNOSIS_MAX_LENGTH.toLocaleString(
        "en-GB"
      )} characters.`
    )
    .optional()
    // An empty textarea arrives as "" — treat that as "no change", not as
    // "blank it".
    .transform((value) => (value ? value : undefined)),
});

/**
 * Payload for writing an item off (US-008 AC4).
 *
 * ⚠️ **Requires an explicit confirmation field.** Writing off is terminal and
 * permanent — the only route back is US-012 — so it must not be reachable by a
 * mis-click on a dropdown. This is the same reasoning that keeps it out of
 * {@link repairStageSchema}.
 */
export const writeOffRepairSchema = z.object({
  intent: z.literal("write-off"),
  confirm: z.literal("WRITE_OFF", {
    errorMap: () => ({ message: "Confirm that this item is beyond repair." }),
  }),
  reason: z
    .string()
    .trim()
    .max(1000, "Keep the reason under 1,000 characters.")
    .optional()
    .transform((value) => (value ? value : undefined)),
});

/**
 * Payload for bringing a written-off item back (US-012).
 *
 * ⚠️ **Deliberately has NO confirmation field**, unlike
 * {@link writeOffRepairSchema}. The asymmetry is the point (`DECISIONS.md`
 * #103): writing off is irreversible destruction, reinstating is reversible and
 * destroys nothing — the record is append-only (#47) and a mistake is undone by
 * writing it off again. Type-to-confirm is this product's gate for irreversible
 * destruction, and borrowing it here would devalue it where it matters.
 *
 * The weight comes from information rather than friction: the action is already
 * `OWNER`/`ADMIN` (#64), the UI puts it behind a dialog that shows the fault and
 * who scrapped it, and AC4 puts a name against every use.
 *
 * There is no `reason` field either — no column stores one (#46's closing note).
 */
export const reinstateRepairSchema = z.object({
  intent: z.literal("reinstate"),
});

/** Any operation on an existing repair. Discriminated on `intent`. */
export const updateRepairSchema = z.discriminatedUnion("intent", [
  transitionRepairSchema,
  writeOffRepairSchema,
  reinstateRepairSchema,
]);
