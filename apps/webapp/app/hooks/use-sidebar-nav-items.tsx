import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  AlarmClockIcon,
  BellIcon,
  BoxesIcon,
  CalendarRangeIcon,
  ChartLineIcon,
  CircleHelpIcon,
  ClipboardCheckIcon,
  FileBarChartIcon,
  HomeIcon,
  MapPinIcon,
  MessageCircleIcon,
  Package,
  PackageOpenIcon,
  ScanBarcodeIcon,
  SettingsIcon,
  TagsIcon,
  UsersRoundIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useLoaderData } from "react-router";
import { UpgradeMessage } from "~/components/marketing/upgrade-message";
import When from "~/components/when/when";
import type { loader } from "~/routes/_layout+/_layout";
import { isPersonalOrg } from "~/utils/organization";
import { useCurrentOrganization } from "./use-current-organization";
import { useUserRoleHelper } from "./user-user-role-helper";

type BaseNavItem = {
  title: string;
  hidden?: boolean;
  Icon: LucideIcon;
  disabled?: boolean | { reason: ReactNode };
  badge?: {
    show: boolean;
    variant?: "unread";
  };
};

export type ChildNavItem = BaseNavItem & {
  type: "child";
  to: string;
  target?: string;
};

export type ParentNavItem = BaseNavItem & {
  type: "parent";
  children: Omit<ChildNavItem, "type" | "Icon">[];
};

type LabelNavItem = Omit<BaseNavItem, "Icon"> & {
  type: "label";
};

type ButtonNavItem = BaseNavItem & {
  type: "button";
  onClick: () => void;
};

export type NavItem =
  | ChildNavItem
  | ParentNavItem
  | LabelNavItem
  | ButtonNavItem;

export function useSidebarNavItems() {
  const { isAdmin, canUseBookings, subscription, unreadUpdatesCount } =
    useLoaderData<typeof loader>();
  const { isBaseOrSelfService, isSelfService } = useUserRoleHelper();
  const currentOrganization = useCurrentOrganization();
  const isPersonalOrganization = isPersonalOrg(currentOrganization);

  const bookingDisabled = useMemo(() => {
    if (canUseBookings) {
      return false;
    }

    return {
      reason: (
        <div>
          <h5>Disabled</h5>
          <p>
            Booking is a premium feature only available for Team workspaces.
          </p>

          <When truthy={!!subscription} fallback={<UpgradeMessage />}>
            <p>Please switch to your team workspace to access this feature.</p>
          </When>
        </div>
      ),
    };
  }, [canUseBookings, subscription]);

  const topMenuItems: NavItem[] = [
    {
      type: "child",
      title: "Admin Dashboard",
      to: "/admin-dashboard/users",
      Icon: ChartLineIcon,
      hidden: !isAdmin,
    },
    {
      type: "label",
      title: "Asset management",
    },
    {
      type: "child",
      title: "Home",
      to: "/home",
      Icon: HomeIcon,
      hidden: isBaseOrSelfService,
    },
    {
      type: "child",
      title: "Assets",
      to: "/assets",
      Icon: PackageOpenIcon,
    },
    {
      type: "child",
      title: "Kits",
      to: "/kits",
      Icon: Package,
    },
    {
      type: "child",
      title: "Categories",
      to: "/categories",
      Icon: BoxesIcon,
      hidden: isBaseOrSelfService,
    },
    {
      type: "child",
      title: "Tags",
      to: "/tags",
      Icon: TagsIcon,
      hidden: isBaseOrSelfService,
    },
    {
      type: "child",
      title: "Locations",
      to: "/locations",
      Icon: MapPinIcon,
      hidden: isBaseOrSelfService,
    },
    {
      type: "child",
      title: "Audits",
      to: "/audits",
      Icon: ClipboardCheckIcon,
    },
    {
      type: "parent",
      title: "Bookings",
      Icon: CalendarRangeIcon,
      disabled: bookingDisabled,
      children: [
        {
          title: "View Bookings",
          to: "/bookings",
          disabled: bookingDisabled,
        },
        {
          title: "Calendar",
          to: "/calendar",
          disabled: bookingDisabled,
        },
      ],
    },
    {
      type: "child",
      title: "Repairs",
      Icon: WrenchIcon,
      // why: `isSelfService`, NOT `isBaseOrSelfService` like every neighbouring
      // entry. This is deliberate, not a copy-paste slip: `BASE` may read the
      // repairs list (`DECISIONS.md` #35) — anyone who can report a fault needs
      // to see whether it has already been reported, or the same fault gets
      // raised again and again. Hiding the entry is decoration either way; the
      // loader enforces `assetRepair:read` server-side.
      hidden: isSelfService,
      to: "/repairs",
    },
    {
      type: "child",
      title: "Reminders",
      Icon: AlarmClockIcon,
      hidden: isBaseOrSelfService,
      to: "/reminders",
    },
    {
      type: "child",
      title: "Reports",
      Icon: FileBarChartIcon,
      hidden: isBaseOrSelfService,
      to: "/reports",
    },
    {
      type: "label",
      title: "Organization",
      hidden: isBaseOrSelfService,
    },
    {
      type: "parent",
      title: "Team",
      Icon: UsersRoundIcon,
      hidden: isBaseOrSelfService,
      children: [
        {
          title: "Users",
          to: "/settings/team/users",
          hidden: isPersonalOrganization,
        },
        {
          title: "Pending invites",
          to: "/settings/team/invites",
          hidden: isPersonalOrganization,
        },
        {
          title: "Non-registered members",
          to: "/settings/team/nrm",
        },
      ],
    },
    {
      type: "parent",
      title: "Workspace settings",
      Icon: SettingsIcon,
      hidden: isBaseOrSelfService,
      children: [
        {
          title: "General",
          to: "/settings/general",
        },
        {
          title: "Bookings",
          to: "/settings/bookings",
          hidden: isPersonalOrganization,
        },
        {
          title: "Custom fields",
          to: "/settings/custom-fields",
        },
        {
          title: "Asset models",
          to: "/settings/asset-models",
        },
      ],
    },
  ];

  // why: the "Asset labels" item pointed at store.shelf.nu — a third-party
  // shop. Removed as a whole array entry, so no empty <li> can be left behind.
  const bottomMenuItems: NavItem[] = [
    {
      type: "child",
      title: "QR Scanner",
      to: "/scanner",
      Icon: ScanBarcodeIcon,
    },
    {
      // Visible to every role. The Help Centre filters its own guides by what
      // the reader can reach (`useHelpAudience`), so there is nothing here to
      // gate — and the roles who see the fewest menu entries are precisely the
      // ones most likely to need it.
      type: "child",
      title: "Help",
      to: "/help",
      Icon: CircleHelpIcon,
    },
    {
      type: "button",
      title: "Updates",
      Icon: BellIcon,
      badge: {
        show: (unreadUpdatesCount || 0) > 0,
        variant: "unread" as const,
      },
      onClick: () => {
        // This will be handled by the sidebar component with popover
      },
    },
    {
      type: "button",
      title: "Questions/Feedback",
      Icon: MessageCircleIcon,
      onClick: () => {
        // Handled by FeedbackNavItem in sidebar-nav.tsx
      },
    },
  ];

  return {
    topMenuItems: removeHiddenNavItems(topMenuItems),
    bottomMenuItems: removeHiddenNavItems(bottomMenuItems),
  };
}

function removeHiddenNavItems(navItems: NavItem[]) {
  return navItems
    .filter((item) => !item.hidden)
    .map((item) => {
      if (item.type === "parent") {
        return {
          ...item,
          children: item.children.filter((child) => !child.hidden),
        };
      }

      return item;
    });
}
