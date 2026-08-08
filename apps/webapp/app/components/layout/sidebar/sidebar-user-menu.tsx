import { useState } from "react";
import {
  ExternalLinkIcon,
  InfoIcon,
  LogOutIcon,
  UserPenIcon,
  UserRoundIcon,
  Wallet,
} from "lucide-react";
import { NavLink, useFetcher, useLoaderData } from "react-router";
import { ChevronRight } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import ProfilePicture from "~/components/user/profile-picture";
import { config } from "~/config/shelf.config";
import type { loader } from "~/routes/_layout+/_layout";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./sidebar";

export default function SidebarUserMenu() {
  const { user } = useLoaderData<typeof loader>();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { isMobile } = useSidebar();
  const fetcher = useFetcher();

  function closeDropdown() {
    setIsDropdownOpen(false);
  }

  function logOut() {
    void fetcher.submit(null, { action: "/logout", method: "POST" });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="!h-auto border !p-1 data-[state=open]:bg-gray-50 data-[state=open]:text-sidebar-accent-foreground hover:bg-gray-50"
            >
              <ProfilePicture
                width="w-8"
                height="h-8"
                className="mr-3 shrink-0"
              />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.username}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronRight className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded p-1"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <ProfilePicture
                  width="w-8"
                  height="h-8"
                  className="mr-3 shrink-0"
                />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {user.username}
                  </span>
                  <span className="truncate text-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              asChild
              className="cursor-pointer gap-2 border-b border-gray-200 p-2"
              onClick={closeDropdown}
            >
              <NavLink to="/me">
                <UserPenIcon className="size-4" />
                My Profile
              </NavLink>
            </DropdownMenuItem>
            <DropdownMenuItem
              asChild
              className="cursor-pointer gap-2 border-b border-gray-200 p-2"
              onClick={closeDropdown}
            >
              <NavLink to="/account-details">
                <UserRoundIcon className="size-4" />
                Account settings
              </NavLink>
            </DropdownMenuItem>
            <DropdownMenuItem
              asChild
              className="cursor-pointer gap-2 border-b border-gray-200 p-2"
              onClick={closeDropdown}
            >
              <NavLink to="/account-details/subscription">
                <Wallet className="size-4" />
                Subscriptions
              </NavLink>
            </DropdownMenuItem>
            {/*
              AGPL-3.0 §13: this instance runs a MODIFIED version of Shelf.nu,
              and users who interact with it over a network must be offered the
              corresponding source. LEGALLY REQUIRED — do not remove this item
              in a future "strip Shelf references" sweep. The wording is
              deliberately "Based on", which is accurate attribution and does
              not imply endorsement.

              Placed in the user menu because that menu is UNGATED: every role
              including SELF_SERVICE can open it, in two clicks from any
              authenticated screen. Do not move it behind a settings route.
            */}
            <DropdownMenuItem
              asChild
              className="cursor-pointer gap-2 border-b border-gray-200 p-2"
              onClick={closeDropdown}
            >
              <a
                href={config.sourceRepositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="About & source code — opens the source repository on GitHub in a new tab"
              >
                <InfoIcon className="size-4 shrink-0" />
                <span className="grid flex-1 leading-tight">
                  <span>About &amp; source code</span>
                  <span className="text-xs text-gray-500">
                    Based on Shelf.nu · AGPL-3.0
                  </span>
                </span>
                <ExternalLinkIcon
                  className="ml-auto size-3.5 shrink-0 text-gray-400"
                  aria-hidden="true"
                />
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="mt-1 cursor-pointer gap-2 border-b border-gray-200 p-2"
              onSelect={logOut}
            >
              <LogOutIcon className="size-4" />
              Log Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
