import {
  COLLECT_BUSINESS_INTEL,
  DISABLE_SIGNUP,
  DISABLE_SSO,
  ENABLE_PREMIUM_FEATURES,
  ENABLE_SCIM,
  FREE_TRIAL_DAYS,
  GEOCODING_USER_AGENT,
  SEND_ONBOARDING_EMAIL,
  SHOW_HOW_DID_YOU_FIND_US,
} from "~/utils/env";
import { Config } from "./types";

export const config: Config = {
  appName: "HCF Production Stock",

  /**
   * AGPL-3.0 §13: this instance runs a MODIFIED version of Shelf.nu and must
   * offer its users the corresponding source. LEGALLY REQUIRED — do not remove
   * this link in a future "strip Shelf references" sweep.
   *
   * TL-8 prefers a release tag over the default branch so the published source
   * matches the deployed build. Verified 2026-08-07: the repository has **no
   * published releases** (`/releases` is empty), so a tag URL would land the
   * user on "There aren't any releases here yet" — a worse offer than the
   * repository itself. Points at the repository root until a release is cut;
   * switch this to
   * `https://github.com/Fudd2020/HCF-Production-Team-Stock/releases/tag/<tag>`
   * the moment one exists.
   */
  sourceRepositoryUrl: "https://github.com/Fudd2020/HCF-Production-Team-Stock",

  sendOnboardingEmail: SEND_ONBOARDING_EMAIL || false,
  enablePremiumFeatures: ENABLE_PREMIUM_FEATURES || false,
  freeTrialDays: Number(FREE_TRIAL_DAYS || 7),
  disableSignup: DISABLE_SIGNUP || false,
  disableSSO: DISABLE_SSO || false,
  enableScim: ENABLE_SCIM || false,

  logoPath: {
    fullLogo: "/static/images/hcf-logo-dark.png",
    symbol: "/static/images/hcf-symbol.png",
    fullLogoInverse: "/static/images/Full-Logo-White-2-lines.png",
  },
  faviconPath: "/static/images/hcf-favicon.ico",
  // why: white text sits on this colour in every email CTA button, so it uses
  // the darkened coral (#D93C2A, 4.55:1) rather than the brand accent
  // (#FF4631, 3.40:1). See design.md "The three brand hexes".
  emailPrimaryColor: "#D93C2A",
  showHowDidYouFindUs: SHOW_HOW_DID_YOU_FIND_US || false,
  collectBusinessIntel:
    COLLECT_BUSINESS_INTEL || SHOW_HOW_DID_YOU_FIND_US || false,
  // Debounce window for recording mobile companion-app activity (1 hour).
  mobileActivityDebounceMs: 60 * 60 * 1000,
  // Companion Android package; declared as the App Links target by the
  // assetlinks.json route. Must match apps/companion/app.json android.package.
  companionAndroidPackageName: "com.shelf.companion",
  geocoding: {
    userAgent: GEOCODING_USER_AGENT || "Self-hosted Asset Management System",
  },
};
