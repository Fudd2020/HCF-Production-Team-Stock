/**
 * The repairs permission matrix, per role (US-007).
 *
 * This story widened who may REPORT a fault from OWNER/ADMIN to all four roles,
 * which makes the matrix itself the deliverable — there is very little code.
 * These tests are therefore the specification: each assertion is one of Neil's
 * decisions written as an executable sentence, so a future "tidy-up" of the
 * matrix meets a named failure rather than silently changing policy.
 *
 * Read as a table:
 *
 * | Role           | report (create) | read list/history | close (update) |
 * | -------------- | --------------- | ----------------- | -------------- |
 * | OWNER          | ✅              | ✅                | ✅             |
 * | ADMIN          | ✅              | ✅                | ✅             |
 * | BASE           | ✅ (US-007)     | ✅ (#35)          | ❌ (#12)       |
 * | SELF_SERVICE   | ✅ (US-007/#43) | ❌ (#35 silence)  | ❌ (#12)       |
 *
 * @see {@link file://./permission.data.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  PermissionAction,
  PermissionEntity,
  Role2PermissionMap,
} from "./permission.data";

/**
 * The repair actions a role holds in the matrix.
 *
 * The `?? []` is not defensive padding — `Role2PermissionMap` is indexed by an
 * enum, so TypeScript cannot prove the lookup is populated. An empty fallback
 * would make a MISSING entry look like a deliberate deny, so the assertion
 * below fails loudly instead: every role must have an explicit entry.
 */
function repairActions(role: OrganizationRoles): PermissionAction[] {
  const actions = Role2PermissionMap[role]?.[PermissionEntity.assetRepair];
  expect(
    actions,
    `${role} has no assetRepair entry in the matrix`
  ).toBeDefined();
  return actions as PermissionAction[];
}

describe("assetRepair permission matrix (US-007)", () => {
  describe("everyone who touches the gear can report", () => {
    it.each([
      OrganizationRoles.OWNER,
      OrganizationRoles.ADMIN,
      OrganizationRoles.BASE,
      OrganizationRoles.SELF_SERVICE,
    ])("%s can report a fault", (role) => {
      /**
       * AC1, `DECISIONS.md` #12 + #43. The whole point of the story: the person
       * who finds a dead radio mic at pack-down is usually not a lead, and a
       * fault captured at the moment it is noticed beats one that depends on
       * someone remembering to mention it on Sunday evening.
       */
      expect(repairActions(role)).toContain(PermissionAction.create);
    });
  });

  describe("closing stays with the leads", () => {
    it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
      "%s cannot close a repair",
      (role) => {
        /**
         * AC3, `DECISIONS.md` #12 — permanent. Reporting confers no right to
         * close, **not even your own report**. If "you can close what you
         * reported" is ever wanted it is a different rule and needs stating as
         * one.
         */
        expect(repairActions(role)).not.toContain(PermissionAction.update);
      }
    );

    it.each([OrganizationRoles.OWNER, OrganizationRoles.ADMIN])(
      "%s can close a repair",
      (role) => {
        expect(repairActions(role)).toContain(PermissionAction.update);
      }
    );
  });

  describe("who may read the list and the fault history", () => {
    it("BASE can read — so the same fault is not raised twice", () => {
      /**
       * AC8, `DECISIONS.md` #35, and Neil's reason for it in his own terms:
       * anyone who can report a fault must be able to see whether it is already
       * reported and what happened last time.
       */
      expect(repairActions(OrganizationRoles.BASE)).toContain(
        PermissionAction.read
      );
    });

    it("SELF_SERVICE canNOT read — silence in #35 is not a grant", () => {
      /**
       * AC10. This is the assertion most likely to be "fixed" by someone
       * making the two restricted roles look symmetrical. They are not
       * symmetrical on purpose: #35 grants read to BASE and stops there.
       *
       * What SELF_SERVICE gets instead is the post-report confirmation panel
       * (AC7) — which exists precisely BECAUSE they have nothing to read
       * afterwards. Granting read here would not be a kindness; it would
       * silently widen access nobody approved.
       */
      expect(repairActions(OrganizationRoles.SELF_SERVICE)).not.toContain(
        PermissionAction.read
      );
    });
  });

  describe("widening reporting widened nothing else", () => {
    it("SELF_SERVICE holds create and ONLY create on repairs", () => {
      // AC4 — the change is confined to this entity and these actions.
      expect(repairActions(OrganizationRoles.SELF_SERVICE)).toEqual([
        PermissionAction.create,
      ]);
    });

    it("BASE holds exactly create and read on repairs", () => {
      expect([...repairActions(OrganizationRoles.BASE)].sort()).toEqual(
        [PermissionAction.create, PermissionAction.read].sort()
      );
    });

    it("neither restricted role gained note access", () => {
      /**
       * AC4 + AC8's trap. `BASE` and `SELF_SERVICE` both hold `note: []`, and
       * this story deliberately did NOT change that — it grants repair
       * reporting, not note creation. It also means the repairs list and the
       * fault history must never be gated on `PermissionEntity.note`, or #35's
       * grant to BASE is silently undone while every test still passes.
       */
      for (const role of [
        OrganizationRoles.BASE,
        OrganizationRoles.SELF_SERVICE,
      ]) {
        expect(Role2PermissionMap[role]?.[PermissionEntity.note]).toEqual([]);
      }
    });
  });
});

/**
 * US-007 AC2, phrased as the story phrases it: a NEGATIVE.
 *
 * `DECISIONS.md` #34 said SELF_SERVICE could report only via a QR scan; #41
 * implemented that as a placement rule. **#43 dropped both**, in enforcement
 * and in placement. AC2 is therefore an assertion that neither was built, and
 * the only way to assert "no code path reads a Scan row" is to look at the code
 * paths.
 *
 * This is a source-level test on purpose. A behavioural test cannot prove a
 * negative — it can only show that one particular request succeeded without
 * scan data, which is exactly what a future regression would still do for the
 * routes it did not change. Reading the feature's own files catches the
 * regression wherever it lands.
 */
describe("no scan coupling anywhere in the repairs feature (AC2)", () => {
  it("no repairs module or route references a Scan row or a scanId", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");

    const moduleDir = join(process.cwd(), "app/modules/asset-repair");
    const routeDir = join(process.cwd(), "app/routes/_layout+");

    const files = [
      ...readdirSync(moduleDir)
        .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
        .map((f) => join(moduleDir, f)),
      ...readdirSync(routeDir)
        .filter(
          (f) =>
            (f.startsWith("repairs") || f.includes("repairs.")) &&
            !f.includes(".test.")
        )
        .map((f) => join(routeDir, f)),
      join(routeDir, "assets.$assetId_.report-fault.tsx"),
    ];

    // Sanity: if the glob ever stops matching, this test would pass vacuously.
    expect(files.length).toBeGreaterThan(4);

    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /\bscanId\b|\bdb\.scan\b|\btx\.scan\b|getScanBy/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
