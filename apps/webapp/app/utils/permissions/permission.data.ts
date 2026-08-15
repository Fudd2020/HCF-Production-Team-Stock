import { OrganizationRoles } from "@prisma/client";

export enum PermissionAction {
  create = "create",
  read = "read",
  update = "update",
  delete = "delete",
  checkout = "checkout",
  checkin = "checkin",
  export = "export",
  import = "import",
  archive = "archive",
  cancel = "cancel",
  extend = "extend",
  manageAssets = "manage-assets",
  custody = "custody",
  manageKits = "manage-kits",
  changeRole = "change-role",
}
export enum PermissionEntity {
  asset = "asset",
  assetIndexSettings = "assetIndexSettings",
  qr = "qr",
  booking = "booking",
  bookingNote = "bookingNote",
  tag = "tag",
  category = "category",
  location = "location",
  locationNote = "locationNote",
  customField = "customField",
  workspace = "workspace",
  teamMember = "teamMember",
  teamMemberProfile = "teamMemberProfile",
  dashboard = "dashboard",
  generalSettings = "generalSettings",
  workingHours = "workingHours",
  subscription = "subscription",
  kit = "kit",
  note = "note",
  scan = "scan",
  custody = "custody",
  assetReminders = "assetReminders",
  /**
   * Equipment repairs (fault reports). `create` = report a fault,
   * `read` = see the repairs list / an asset's fault history,
   * `update` = mark a repair complete.
   *
   * v1 (US-001) grants ADMIN/OWNER only — `BASE` and `SELF_SERVICE` are
   * deliberately empty here and are widened by US-007 (`DECISIONS.md` #12,
   * #35, #43). Declared explicitly for every role even though ADMIN/OWNER
   * reach allow-all through `hasPermission()`'s short-circuit, so US-007 has
   * something to widen rather than something to invent.
   */
  assetRepair = "assetRepair",
  audit = "audit",
  auditNote = "auditNote",
  teamMemberNote = "teamMemberNote",
  assetModel = "assetModel",
  emailSettings = "emailSettings",
  userData = "user-data", // This is for the user to load their own data.
  update = "update",
  commandPaletteSearch = "command-palette-search",
}

//this will come from DB eventually
export const Role2PermissionMap: {
  [K in OrganizationRoles]?: Record<PermissionEntity, PermissionAction[]>;
} = {
  [OrganizationRoles.BASE]: {
    [PermissionEntity.asset]: [PermissionAction.read],
    [PermissionEntity.assetIndexSettings]: [PermissionAction.read],
    [PermissionEntity.booking]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete, // This is for the user to delete their own bookings only when they are draft.
      PermissionAction.manageAssets,
      PermissionAction.manageKits,
      PermissionAction.export,
    ],
    [PermissionEntity.bookingNote]: [
      PermissionAction.read,
      PermissionAction.create,
    ],
    [PermissionEntity.auditNote]: [
      PermissionAction.read,
      PermissionAction.create,
    ],
    [PermissionEntity.audit]: [PermissionAction.read, PermissionAction.update],
    [PermissionEntity.qr]: [PermissionAction.read],
    [PermissionEntity.category]: [],
    [PermissionEntity.customField]: [],
    [PermissionEntity.location]: [],
    [PermissionEntity.locationNote]: [],
    [PermissionEntity.tag]: [],
    [PermissionEntity.teamMember]: [],
    [PermissionEntity.teamMemberProfile]: [],
    [PermissionEntity.workspace]: [],
    [PermissionEntity.dashboard]: [],
    [PermissionEntity.generalSettings]: [],
    [PermissionEntity.workingHours]: [PermissionAction.read],
    [PermissionEntity.subscription]: [],
    [PermissionEntity.kit]: [PermissionAction.read],
    [PermissionEntity.note]: [],
    [PermissionEntity.scan]: [],
    [PermissionEntity.custody]: [],
    [PermissionEntity.assetReminders]: [],
    /**
     * US-007 (`DECISIONS.md` #12, #35, #43) — BASE may REPORT a fault and READ
     * the repairs list and an asset's fault history.
     *
     * `read` is #35: anyone who can report must be able to see whether it is
     * already reported and what happened last time, or the same fault gets
     * raised over and over.
     *
     * `create` is #12, widened here from US-001's OWNER/ADMIN-only v1. There is
     * **no entry-point restriction** — #43 dropped the scan rule entirely, in
     * enforcement AND in placement.
     *
     * `update` (mark repaired) stays OWNER/ADMIN **permanently** (#12).
     * Reporting a fault confers no right to close it, not even your own
     * (US-007 AC3).
     */
    [PermissionEntity.assetRepair]: [
      PermissionAction.create,
      PermissionAction.read,
    ],
    [PermissionEntity.teamMemberNote]: [],
    [PermissionEntity.assetModel]: [PermissionAction.read],
    [PermissionEntity.emailSettings]: [],
    [PermissionEntity.userData]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.update]: [PermissionAction.read],
    [PermissionEntity.commandPaletteSearch]: [PermissionAction.read],
  },
  [OrganizationRoles.SELF_SERVICE]: {
    [PermissionEntity.asset]: [PermissionAction.read, PermissionAction.custody],
    [PermissionEntity.assetIndexSettings]: [PermissionAction.read],
    [PermissionEntity.booking]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.checkout,
      PermissionAction.checkin,
      PermissionAction.delete, // This is for the user to delete their own bookings only when they are draft.
      PermissionAction.archive,
      PermissionAction.manageAssets,
      PermissionAction.manageKits,
      PermissionAction.cancel,
      PermissionAction.extend,
      PermissionAction.export,
    ],
    [PermissionEntity.bookingNote]: [
      PermissionAction.read,
      PermissionAction.create,
    ],
    [PermissionEntity.auditNote]: [
      PermissionAction.read,
      PermissionAction.create,
    ],
    [PermissionEntity.audit]: [PermissionAction.read, PermissionAction.update],
    [PermissionEntity.qr]: [PermissionAction.read],
    [PermissionEntity.category]: [],
    [PermissionEntity.customField]: [],
    [PermissionEntity.location]: [],
    [PermissionEntity.locationNote]: [],
    [PermissionEntity.tag]: [],
    [PermissionEntity.teamMember]: [],
    [PermissionEntity.teamMemberProfile]: [],
    [PermissionEntity.workspace]: [],
    [PermissionEntity.dashboard]: [],
    [PermissionEntity.generalSettings]: [],
    [PermissionEntity.workingHours]: [PermissionAction.read],
    [PermissionEntity.subscription]: [],
    [PermissionEntity.kit]: [PermissionAction.read, PermissionAction.custody],
    [PermissionEntity.note]: [],
    [PermissionEntity.scan]: [],
    [PermissionEntity.custody]: [],
    [PermissionEntity.assetReminders]: [],
    /**
     * US-007 (`DECISIONS.md` #43) — SELF_SERVICE may REPORT a fault, from
     * anywhere they can reach an asset. A QR scan, a bookmark, a row on their
     * own booking, a link someone sent them: all equivalent. Nothing in this
     * feature reads a `Scan` row or a `scanId`, and nothing may start
     * (US-007 AC2, which is deliberately phrased as a negative because #34 and
     * #41 proposed exactly that and were superseded).
     *
     * ⚠️ **`read` is deliberately NOT granted, and that is settled rather than
     * deferred.** #35 gives the repairs list and fault history to `BASE` and
     * nobody below it; silence is not a grant. Do not add `read` to "match" the
     * BASE entry above — the post-report confirmation panel
     * (`FaultReportedPanel`, US-007 AC7) is how this role learns their report
     * landed, precisely because they have nothing here to read afterwards.
     *
     * In practice the scan will still be their usual route, because their asset
     * index is force-filtered to bookable items — but that is a consequence of
     * how they browse, NOT a rule the system enforces.
     */
    [PermissionEntity.assetRepair]: [PermissionAction.create],
    [PermissionEntity.teamMemberNote]: [],
    [PermissionEntity.assetModel]: [],
    [PermissionEntity.emailSettings]: [],
    [PermissionEntity.userData]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.update]: [PermissionAction.read],
    [PermissionEntity.commandPaletteSearch]: [PermissionAction.read],
  },
  [OrganizationRoles.ADMIN]: {
    [PermissionEntity.asset]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.custody,
      PermissionAction.import,
      PermissionAction.export,
    ],
    [PermissionEntity.assetIndexSettings]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.booking]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.checkout,
      PermissionAction.checkin,
      PermissionAction.archive,
      PermissionAction.manageAssets,
      PermissionAction.manageKits,
      PermissionAction.cancel,
      PermissionAction.extend,
      PermissionAction.export,
    ],
    [PermissionEntity.bookingNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.auditNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.qr]: [PermissionAction.read],
    [PermissionEntity.category]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.customField]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.location]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.locationNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.delete,
    ],
    [PermissionEntity.tag]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.teamMember]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.changeRole,
    ],
    [PermissionEntity.teamMemberProfile]: [PermissionAction.read],
    [PermissionEntity.workspace]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    // `create` = report a fault (US-001), `read` = repairs list / fault history
    // (US-003, US-004), `update` = mark repaired (US-005, `DECISIONS.md` #12).
    [PermissionEntity.assetRepair]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.dashboard]: [PermissionAction.read],
    [PermissionEntity.generalSettings]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.workingHours]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.subscription]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.kit]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.custody,
    ],
    [PermissionEntity.note]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.scan]: [PermissionAction.read],
    [PermissionEntity.custody]: [PermissionAction.read],
    [PermissionEntity.assetReminders]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.audit]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.archive,
    ],
    [PermissionEntity.teamMemberNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.delete,
    ],
    [PermissionEntity.assetModel]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.emailSettings]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.userData]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.update]: [PermissionAction.read],
    [PermissionEntity.commandPaletteSearch]: [PermissionAction.read],
  },
  [OrganizationRoles.OWNER]: {
    [PermissionEntity.asset]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.custody,
      PermissionAction.import,
      PermissionAction.export,
    ],
    [PermissionEntity.assetIndexSettings]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.booking]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.checkout,
      PermissionAction.checkin,
      PermissionAction.archive,
      PermissionAction.manageAssets,
      PermissionAction.manageKits,
      PermissionAction.cancel,
      PermissionAction.extend,
      PermissionAction.export,
    ],
    [PermissionEntity.bookingNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.auditNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.qr]: [PermissionAction.read],
    [PermissionEntity.category]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.customField]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.location]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.locationNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.delete,
    ],
    [PermissionEntity.tag]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.teamMember]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.changeRole,
    ],
    [PermissionEntity.teamMemberProfile]: [PermissionAction.read],
    [PermissionEntity.workspace]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    // `create` = report a fault (US-001), `read` = repairs list / fault history
    // (US-003, US-004), `update` = mark repaired (US-005, `DECISIONS.md` #12).
    [PermissionEntity.assetRepair]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.dashboard]: [PermissionAction.read],
    [PermissionEntity.generalSettings]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.workingHours]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.subscription]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.kit]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.custody,
    ],
    [PermissionEntity.note]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.scan]: [PermissionAction.read],
    [PermissionEntity.custody]: [PermissionAction.read],
    [PermissionEntity.assetReminders]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.audit]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.archive,
    ],
    [PermissionEntity.teamMemberNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.delete,
    ],
    [PermissionEntity.assetModel]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.emailSettings]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.userData]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.update]: [PermissionAction.read],
    [PermissionEntity.commandPaletteSearch]: [PermissionAction.read],
  },
};
