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
