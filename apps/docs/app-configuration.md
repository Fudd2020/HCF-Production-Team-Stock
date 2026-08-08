# App configuration - shelf.config.ts

This file contains configuration options that are used to adjust and disable certain functionalities in Shelf.nu.

```ts
// shelf.config.ts
import {
  DISABLE_SIGNUP,
  DISABLE_SSO,
  ENABLE_PREMIUM_FEATURES,
  FREE_TRIAL_DAYS,
  SEND_ONBOARDING_EMAIL,
} from "~/utils/env";
import { Config } from "./types";

export const config: Config = {
  appName: "HCF Production Stock",
  sourceRepositoryUrl: "https://github.com/<org>/<fork>",
  sendOnboardingEmail: SEND_ONBOARDING_EMAIL || false,
  enablePremiumFeatures: ENABLE_PREMIUM_FEATURES || false,
  freeTrialDays: Number(FREE_TRIAL_DAYS || 7),
  disableSignup: DISABLE_SIGNUP || false,
  disableSSO: DISABLE_SSO || false,
  logoPath: {
    fullLogo: "/static/images/logo-full-color(x2).png",
    symbol: "/static/images/shelf-symbol.png",
  },
  faviconPath: "/static/favicon.ico",
  emailPrimaryColor: "#EF6820",
  showHowDidYouFindUs: SHOW_HOW_DID_YOU_FIND_US || false,
};
```

> A rebranded instance sets `appName`, `sourceRepositoryUrl`, `logoPath`,
> `faviconPath` and `emailPrimaryColor` to its own values. See
> [Branding & White-Labeling](./branding.md) for the full walkthrough,
> including why `appName` is **not** an environment variable and the AGPL
> obligation behind `sourceRepositoryUrl`.

## Configuration Options

### appName

Human-readable application name. Single source of truth for page titles (via
`appendToMetaTitle`), the root `meta` title, logo `alt` text, transactional
email copy and the PWA manifest.

**This is a `Config` field, not an environment variable** — unlike most of the
flags below, there is no env var override. Change it in `shelf.config.ts` and
redeploy.

```ts
// Custom app name
appName: "My Asset Tracker";
```

### sourceRepositoryUrl

Public URL of the repository holding this instance's corresponding source.

Only relevant if you're running a **modified** version of Shelf under the
AGPL-3.0 licence — §13 requires you to offer that source to anyone who
interacts with the app over a network. Deliberately a non-optional `string` in
the `Config` type: a nullish value bound to a link renders a silently dead
control. See [Branding & White-Labeling](./branding.md#the-agpl-obligation)
for where this is linked from in the UI and why it should point at a release
tag once one exists.

```ts
// Point at your fork's public repository (or a release tag once one exists)
sourceRepositoryUrl: "https://github.com/my-org/my-shelf-fork";
```

### sendOnboardingEmail

This flag controls whether the onboarding email will be sent to new users. The email is sent within the action of `routes/_welcome+/onboarding.tsx`.

**Default value:** `false`  
**Environment variable:** `SEND_ONBOARDING_EMAIL`

```ts
// Enable onboarding emails
sendOnboardingEmail: true;
```

### enablePremiumFeatures

Choose whether you want premium features to be enabled. Setting this to `false` will allow your users to use all features of Shelf without limitations.

**Default value:** `false`  
**Environment variable:** `ENABLE_PREMIUM_FEATURES`

```ts
// Enable premium features
enablePremiumFeatures: true;
```

You can set this directly in the config file or use the environment variable to have different configurations on different servers.

### collectBusinessIntel

Controls whether business intelligence fields are collected during user onboarding. When enabled, users are asked to provide:

- How they heard about Shelf (referral source)
- Their role
- Team size
- Company/Organization name (for self-serve signups)
- Optional customization questions (primary use case, current solution, timeline)

When a user selects "Personal use" as their role, the team size and company name fields are automatically hidden.

**Default value:** `false`
**Environment variable:** `COLLECT_BUSINESS_INTEL`

```ts
// Enable business intelligence collection
collectBusinessIntel: true;
```

**Backwards Compatibility:** If `COLLECT_BUSINESS_INTEL` is not set, it falls back to `SHOW_HOW_DID_YOU_FIND_US` for compatibility with existing configurations.

### showHowDidYouFindUs

> **⚠️ Deprecated:** Use `collectBusinessIntel` instead. This option is kept for backwards compatibility.

Choose whether an open field will be shown on the onboarding page, asking the user to provide info on how they found out about Shelf.

**Default value:** `false`
**Environment variable:** `SHOW_HOW_DID_YOU_FIND_US`

### freeTrialDays

Sets the number of days for the free trial period when premium features are enabled.

**Default value:** `7`  
**Environment variable:** `FREE_TRIAL_DAYS`

```ts
// Set 14-day free trial
freeTrialDays: 14;
```

### disableSignup

Prevents new users from signing up to your Shelf instance. Useful for closed/private instances.

**Default value:** `false`  
**Environment variable:** `DISABLE_SIGNUP`

```ts
// Disable new user registrations
disableSignup: true;
```

### disableSSO

Disables Single Sign-On functionality even if SSO providers are configured.

**Default value:** `false`  
**Environment variable:** `DISABLE_SSO`

```ts
// Disable SSO login
disableSSO: true;
```

### enableScim

Enables SCIM 2.0 user provisioning, so an identity provider (Microsoft Entra ID,
Okta) can create, update and deactivate users in a workspace automatically.

Unlike the other flags this one is **opt-in** — SCIM stays off unless you
explicitly enable it. While disabled, the SCIM API responds `404` and the SCIM
section in workspace settings is hidden.

Requires SSO to be configured on the workspace: SCIM only provisions users whose
email domain matches the workspace's verified SSO domain.

> Not currently available on Shelf Cloud. Self-hosted deployments can enable it.

**Default value:** `false`  
**Environment variable:** `ENABLE_SCIM`

```ts
// Enable SCIM provisioning
enableScim: true;
```

### logoPath

Defines the paths to your application logos. These are used throughout the application interface.

**Default values:**

- `fullLogo`: `"/static/images/logo-full-color(x2).png"`
- `symbol`: `"/static/images/shelf-symbol.png"`

```ts
// Custom logo paths
logoPath: {
  fullLogo: "/static/images/my-custom-logo.png",
  symbol: "/static/images/my-symbol.png",
}
```

### faviconPath

Path to your application's favicon.

**Default value:** `"/static/favicon.ico"`

```ts
// Custom favicon
faviconPath: "/static/my-favicon.ico";
```

### emailPrimaryColor

Primary color used in email templates and notifications.

**Default value:** `"#EF6820"` (Shelf orange)

```ts
// Custom email color
emailPrimaryColor: "#FF5733";
```

## Environment Variables

You can override any of these settings using environment variables:

```bash
# .env file
SEND_ONBOARDING_EMAIL=true
ENABLE_PREMIUM_FEATURES=false
FREE_TRIAL_DAYS=14
DISABLE_SIGNUP=false
DISABLE_SSO=false
ENABLE_SCIM=false
COLLECT_BUSINESS_INTEL=true
# SHOW_HOW_DID_YOU_FIND_US=true  # Deprecated, use COLLECT_BUSINESS_INTEL instead
```

### FEEDBACK_EMAIL

Destination address for in-app feedback and "Report this issue" submissions
(the button on every error screen, and — where enabled — the sidebar feedback
entry point). Resolved server-side by `resolveFeedbackRecipient()` in
`app/utils/env.ts`:

```ts
// apps/webapp/app/utils/env.ts
export function resolveFeedbackRecipient(): string | undefined {
  return FEEDBACK_EMAIL || SUPPORT_EMAIL || ADMIN_EMAIL || undefined;
}
```

`FEEDBACK_EMAIL` is tried first, then `SUPPORT_EMAIL`, then `ADMIN_EMAIL`. If
none of the three is set, the send is **skipped** and a warning is logged —
feedback is never delivered to a guessed or hardcoded address. This variable
is server-only; it is deliberately **not** published via `getBrowserEnv()`.

```bash
# .env file
FEEDBACK_EMAIL=support@example.org
```

> **This variable is not currently in `.env.example`.** At the time it was
> added, `.env.example` was already deleted in the working tree by unrelated,
> pre-existing changes unrelated to this variable — recreating it would have
> reverted that deletion. Until `.env.example` is restored, this page is the
> only discoverable record that `FEEDBACK_EMAIL` exists. If you restore
> `.env.example`, add `FEEDBACK_EMAIL` (and its `SUPPORT_EMAIL`/`ADMIN_EMAIL`
> fallbacks) to it.

## Notes

- Changes to this file require a server restart to take effect
- Environment variables take precedence over hardcoded values
- Logo and favicon paths are relative to the `public` directory
- Email colors should be in hex format (`#RRGGBB`)
