/**
 * Regression guard for email **subject** lines (US-004 AC4).
 *
 * why this is a source scan rather than a behaviour test: the subject is built
 * at the call site, not in the template — eighteen of them live inside
 * `app/modules/**` service and worker files whose senders need a database, a
 * scheduler and a resolved organisation to reach. Rendering them for real
 * would mean mocking most of the app to assert on one string, and mocks that
 * heavy stop testing anything.
 *
 * The subject is the first thing the recipient reads, so it is the one part of
 * the email a branding sweep must not miss — and this class travels in packs
 * (the sweep that produced this test found eighteen sites where the contract
 * named none). Scanning the source keeps the guard cheap and, crucially, keeps
 * it working for sites nobody has thought of yet.
 *
 * The patterns match the trailing-suffix form the subjects actually used
 * (`` `… - shelf.nu` `` / `` `… - Shelf` `` / `"… - Shelf"`), so prose in a
 * comment mentioning Shelf — which several files legitimately have, explaining
 * what was removed — does not trip it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Repo-relative paths of every module that builds an email subject line. */
const SUBJECT_BUILDING_FILES = [
  "app/modules/booking/service.server.ts",
  "app/modules/booking/worker.server.ts",
  "app/modules/booking/email-helpers.ts",
  "app/modules/audit/email-helpers.ts",
  "app/modules/asset-reminder/worker.server.ts",
  "app/modules/organization/service.server.ts",
  "app/modules/invite/service.server.ts",
  "app/modules/user/service.server.ts",
];

/**
 * Suffix forms a Shelf-branded subject line took. Anchored on the closing
 * quote so only a string *ending* in the brand matches.
 */
const SHELF_SUFFIX_PATTERNS = [/ - shelf\.nu["`']/i, / - Shelf["`']/];

/** Absolute path to the webapp package root (this file is two levels down). */
const WEBAPP_ROOT = join(__dirname, "..", "..");

describe("email subject lines", () => {
  it.each(SUBJECT_BUILDING_FILES)(
    "%s carries no Shelf-branded subject suffix",
    (relativePath) => {
      const source = readFileSync(join(WEBAPP_ROOT, relativePath), "utf8");

      for (const pattern of SHELF_SUFFIX_PATTERNS) {
        expect(source).not.toMatch(pattern);
      }
    }
  );

  it.each(SUBJECT_BUILDING_FILES)(
    "%s builds its subject from config.appName rather than a typed literal",
    (relativePath) => {
      const source = readFileSync(join(WEBAPP_ROOT, relativePath), "utf8");

      // Every file in this list sends at least one email whose subject names
      // the app, so each must interpolate the config value (US-001 AC6).
      expect(source).toContain("config.appName");
    }
  );
});
