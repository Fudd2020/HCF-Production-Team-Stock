export interface Config {
  /**
   * Human-readable application name.
   *
   * Single source of truth for page titles (`appendToMetaTitle`), the root
   * `meta` title, logo `alt` text, transactional email copy and the PWA
   * manifest. Change this value and every user-facing surface follows.
   *
   * The PWA manifest is a static file (`public/static/manifest.json`) rather
   * than a generated resource route — it is pinned to this value by
   * `app/config/manifest.test.ts`, so changing the name here fails that test
   * until the manifest is updated too.
   */
  appName: string;

  /**
   * Public URL of the repository holding this instance's corresponding source.
   *
   * AGPL-3.0 §13: this instance runs a MODIFIED version of Shelf.nu and must
   * offer its users the corresponding source. LEGALLY REQUIRED — do not remove
   * this value, or the UI that links to it, in a future "strip Shelf
   * references" sweep.
   *
   * Deliberately a non-optional `string`: a nullish value bound to a
   * `<Button to>` / `<a href>` renders a silently dead control that both
   * typecheck and unit tests miss. See
   * `.claude/rules/resolve-nullish-button-to.md`.
   */
  sourceRepositoryUrl: string;

  /**
   * Enable sending of onboarding email.
   * Email gets sent when user is onboarded and we have their first and last name
   * */
  sendOnboardingEmail: boolean;

  /**
   * Number of days for the free trial
   */
  freeTrialDays: number;

  /**
   * Enable premium features
   */
  enablePremiumFeatures: boolean;

  /**
   * Logo paths
   * Used to override the default logo. `fullLogo` and `symbol` are required.
   */
  logoPath?: {
    /** Wide lockup (symbol + wordmark), dark artwork for light surfaces. */
    fullLogo: string;
    /** Square symbol only — collapsed sidebar rail, auth pages, PWA icon. */
    symbol: string;
    /**
     * White/inverse lockup, for placing on a dark surface (the auth cover
     * panel). Optional: surfaces that need it must handle its absence.
     */
    fullLogoInverse?: string;
  };

  /**
   * Primary color for emails
   */
  emailPrimaryColor: string;

  /**
   * Path to favicon
   */
  faviconPath: string;

  /**
   * Disable the signup functionality
   * Set this to true to disable user registration. New users will still be possible to be added via sending invites.
   * As a side effect of this, users will not get a personal workspace. This is because new accounts will only be possible to be created via invites.
   */
  disableSignup: boolean;

  /**
   * Disable SSO
   */
  disableSSO: boolean;

  /**
   * Enable SCIM user provisioning (RFC 7643/7644).
   *
   * Opt-in — disabled unless `ENABLE_SCIM="true"` is set. When off, the SCIM API
   * responds 404 and the SCIM settings section is hidden. Not yet available on
   * Shelf Cloud.
   */
  enableScim: boolean;

  /**
   * Show the "How did you find us?" field in the onboarding process
   * This is useful for gathering feedback on how users discover the platform.
   * @deprecated Use collectBusinessIntel instead. Kept for backwards compatibility.
   */
  showHowDidYouFindUs: boolean;

  /**
   * Collect business intelligence data during onboarding
   * When enabled, shows additional fields like role, team size, company name, etc.
   * If COLLECT_BUSINESS_INTEL is not set, falls back to SHOW_HOW_DID_YOU_FIND_US for backwards compatibility.
   */
  collectBusinessIntel: boolean;

  /**
   * Debounce window (ms) for recording mobile companion-app activity.
   * Internal telemetry threshold used by the mobile API; not env-driven.
   */
  mobileActivityDebounceMs: number;

  /**
   * The Companion app's Android package name (e.g. `com.shelf.companion`).
   * The webapp's `assetlinks.json` route declares it as the App Links target,
   * so it lives here as the single source rather than being hardcoded in the
   * route. Must match `apps/companion/app.json` -> `android.package`.
   */
  companionAndroidPackageName: string;

  /**
   * Geocoding configuration
   */
  geocoding: {
    /**
     * User-Agent string for geocoding requests
     * Used to identify the application to the geocoding service
     */
    userAgent: string;
  };
}
