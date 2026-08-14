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
    // US-003 AC8 / `DECISIONS.md` #35: BASE MAY read the workspace repairs
    // list and an asset's fault history — anyone who can report a fault must be
    // able to see whether it is already reported, or the same fault gets raised
    // again and again. `create` (report a fault) is still US-001 AC10's OWNER /
    // ADMIN only and is widened by US-007; `update` (mark repaired) stays
    // OWNER / ADMIN permanently (#12).
    [PermissionEntity.assetRepair]: [PermissionAction.read],
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
    // US-001 AC10: SELF_SERVICE cannot report a fault yet. US-007 widens
    // `create` (`DECISIONS.md` #43 — from anywhere they can reach an asset).
    // ⚠️ `read` is deliberately NOT granted, and this is settled rather than
    // deferred: US-003 AC8 gives the repairs list to `BASE` and nobody below it
    // (#35). US-007's confirmation panel exists precisely because a
    // SELF_SERVICE reporter has nothing here to read afterwards. Do not add
    // `read` to "match" the BASE entry above.
    [PermissionEntity.assetRepair]: [],
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
