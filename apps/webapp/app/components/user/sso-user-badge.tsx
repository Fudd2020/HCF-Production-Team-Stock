import { GrayBadge } from "../shared/gray-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

export const SSOUserBadge = ({
  userId,
  sso,
}: {
  userId: string;
  sso: boolean;
}) => {
  if (!sso) return null;

  return (
    <TooltipProvider key={userId}>
      <Tooltip>
        <TooltipTrigger>
          <GrayBadge className="ml-2">SSO</GrayBadge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72">
          <h4>SSO user</h4>

          <p className="mt-2">
            This user signs in with Single Sign-On (SSO). Their access is
            managed by an external identity provider, and their permissions are
            revalidated on every login attempt. If you want to remove them
            immediately, use the revoke access user action here. You will still
            need to remove them from the IDP to make this complete.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
