import { KitStatus } from "@prisma/client";
import { BADGE_COLORS, type BadgeColorScheme } from "~/utils/badge-colors";
import type { ExtendedKitStatus } from "~/utils/booking-assets";
import { Badge } from "../shared/badge";
import { UnavailableBadge } from "../shared/unavailable-badge";

export function userFriendlyKitStatus(status: ExtendedKitStatus) {
  switch (status) {
    case KitStatus.IN_CUSTODY:
      return "In Custody";
    case KitStatus.CHECKED_OUT:
      return "Checked Out";
    case "PARTIALLY_CHECKED_IN":
      return "Already checked in";
    default:
      return "Available";
  }
}

export const kitStatusColorMap = (
  status: ExtendedKitStatus
): BadgeColorScheme => {
  switch (status) {
    case KitStatus.IN_CUSTODY:
      return BADGE_COLORS.blue;
    case "PARTIALLY_CHECKED_IN":
      return BADGE_COLORS.blue;
    case KitStatus.CHECKED_OUT:
      return BADGE_COLORS.violet;
    default:
      // AVAILABLE
      return BADGE_COLORS.green;
  }
};

/**
 * The kit's status, plus why it cannot be booked when that applies.
 *
 * **Two different unbookable reasons, told apart on purpose (US-006 AC1).**
 * A kit can be off the table because an admin parked a member
 * (`availableToBook = false`) or because a member is physically broken (an open
 * repair). They look identical to the booking guard and are completely
 * different to a person: one is a setting somebody chose, the other is a job
 * somebody has to do. Collapsing them into one "unavailable" chip is what makes
 * a lead hunt through six assets to find out which.
 *
 * The repair chip conveys **availability only** — never the fault text, the
 * reporter or the diagnosis. `SELF_SERVICE` can read kits but holds no
 * `assetRepair` grant (`DECISIONS.md` #35), so a kit surface that leaked fault
 * detail would hand them a read nobody granted.
 *
 * @param props.status - The kit's own status, including the synthetic values
 * @param props.availableToBook - False when a member is manually parked
 * @param props.hasFaultyMember - True when a member has an open repair (US-006)
 */
export function KitStatusBadge({
  status,
  availableToBook = true,
  hasFaultyMember = false,
}: {
  status: ExtendedKitStatus;
  availableToBook: boolean;
  /**
   * Defaulted so the ~dozen existing call sites keep compiling and keep their
   * current behaviour. A surface that has not been wired for US-006 shows no
   * repair chip rather than a wrong one — the loader is what makes it appear.
   */
  hasFaultyMember?: boolean;
}) {
  const colors = kitStatusColorMap(status);
  return (
    <div className="flex items-center gap-[6px]">
      <Badge color={colors.bg} textColor={colors.text}>
        {userFriendlyKitStatus(status)}
      </Badge>
      {hasFaultyMember && (
        <Badge
          color={BADGE_COLORS.red.bg}
          textColor={BADGE_COLORS.red.text}
          /**
           * Red and worded as a problem, matching the `In repair` chip on the
           * asset surfaces (`design.md` D2) — the same fact about the same
           * item, so it must not read differently here.
           */
        >
          Member out of action
        </Badge>
      )}
      {/*
        Suppressed when a repair is the reason, so the row carries ONE
        explanation rather than two chips that contradict each other about the
        cause. A manually-parked member still shows its own badge when there is
        no repair.
      */}
      {!availableToBook && !hasFaultyMember && (
        <UnavailableBadge title="This kit is not available for Bookings because some of its assets are marked as unavailable" />
      )}
    </div>
  );
}
