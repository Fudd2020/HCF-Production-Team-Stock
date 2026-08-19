/**
 * Resolves what the Help Centre should show the current reader.
 *
 * Deliberately built from the same inputs the sidebar gates on — the workspace
 * role helper plus the layout loader's `isAdmin` / `canUseBookings` — so a
 * guide is visible exactly when the menu entry it documents is. Anything that
 * changes `use-sidebar-nav-items.tsx` should be reflected in the topics'
 * `visibleTo` predicates.
 *
 * @see {@link file://./../modules/help/content.ts}
 * @see {@link file://./use-sidebar-nav-items.tsx}
 */

import { useMemo } from "react";
import { useRouteLoaderData } from "react-router";
import type { HelpAudience } from "~/modules/help/content";
import type { loader } from "~/routes/_layout+/_layout";
import { useUserRoleHelper } from "./user-user-role-helper";

/**
 * @returns The reader's capabilities, as the Help Centre understands them
 */
export function useHelpAudience(): HelpAudience {
  const layoutData = useRouteLoaderData<typeof loader>(
    "routes/_layout+/_layout"
  );
  const { isAdministratorOrOwner, isSelfService, isBaseOrSelfService } =
    useUserRoleHelper();

  const isAdmin = layoutData?.isAdmin ?? false;
  const canUseBookings = layoutData?.canUseBookings ?? false;

  return useMemo(
    () => ({
      isAdministratorOrOwner,
      isSelfService,
      isBaseOrSelfService,
      isAdmin,
      canUseBookings,
    }),
    [
      isAdministratorOrOwner,
      isSelfService,
      isBaseOrSelfService,
      isAdmin,
      canUseBookings,
    ]
  );
}
