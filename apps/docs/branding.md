# Branding & White-Labeling

This is a self-hosted fork of [Shelf.nu](https://github.com/Shelf-nu/shelf.nu),
rebranded as **HCF Production Stock** for Huddersfield Christian Fellowship's
production team (PA and video equipment). This page is for whoever maintains
this fork after the initial rebrand: how to change a logo, a colour or the app
name, and the two things that are easy to get wrong.

Everything described here shipped in the `hcf-branding` feature and is
verified against the code as it stands, not against what was planned for it.

## One config object drives almost everything

`apps/webapp/app/config/shelf.config.ts` exports a single `config` object,
typed by `apps/webapp/app/config/types.ts`. The fields that matter for a
rebrand:

```ts
// apps/webapp/app/config/shelf.config.ts
export const config: Config = {
  appName: "HCF Production Stock",
  sourceRepositoryUrl: "https://github.com/Fudd2020/HCF-Production-Team-Stock",
  logoPath: {
    fullLogo: "/static/images/hcf-logo-dark.png",
    symbol: "/static/images/hcf-symbol.png",
    fullLogoInverse: "/static/images/Full-Logo-White-2-lines.png",
  },
  faviconPath: "/static/images/hcf-favicon.ico",
  emailPrimaryColor: "#D93C2A",
  // ...
};
```

Change one of these fields and the whole app follows — logos, page titles,
email branding and the AGPL notice are all read from here rather than
hardcoded at each call site. There is no artwork fallback: if `logoPath` is
ever unset, the `<img>` tags degrade to their `alt` text (`config.appName`),
never to Shelf's own symbol or wordmark — see the file-level comment in
[`app/components/marketing/logos.tsx`](https://github.com/Fudd2020/HCF-Production-Team-Stock/blob/main/apps/webapp/app/components/marketing/logos.tsx).

### `appName` is a config field, NOT an environment variable

This trips people up because most of the other feature flags in this file
(`enablePremiumFeatures`, `disableSignup`, …) **are** backed by an env var.
`appName` deliberately is not: it is consumed at build/runtime directly from
`Config`, not resolved through `~/utils/env`. To change the app's name you
edit `shelf.config.ts` and redeploy — there is no `APP_NAME` env var to set
instead, and setting one will do nothing.

The single chokepoint that turns `appName` into a page title is
[`app/utils/append-to-meta-title.ts`](https://github.com/Fudd2020/HCF-Production-Team-Stock/blob/main/apps/webapp/app/utils/append-to-meta-title.ts):

```ts
// apps/webapp/app/utils/append-to-meta-title.ts
export const appendToMetaTitle = (title: string | null | undefined) =>
  `${title ? title : "Not found"} | ${config.appName}`;
```

Around 325 route `meta` exports call this function rather than typing the app
name themselves. If you rename the app, none of those call sites change — only
`shelf.config.ts` does. Note the `null`/`undefined` branch: an unmatched route
renders `"Not found | HCF Production Stock"`, not a blank title.

The PWA manifest (`apps/webapp/public/static/manifest.json`) is a **static
file**, not generated from `config.appName` — see [Progressive Web App
manifest](#progressive-web-app-manifest) below for why, and how it stays in
sync.

### Logos

Logo artwork lives in `apps/webapp/public/static/images/`:

| File                          | Used for                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hcf-logo-dark.png`           | `logoPath.fullLogo` — expanded sidebar, mobile header, `/qr/:id`                                                                                                  |
| `hcf-symbol.png`              | `logoPath.symbol` — collapsed sidebar rail, auth pages, PWA icon                                                                                                  |
| `Full-Logo-White-2-lines.png` | `logoPath.fullLogoInverse` — the dark auth cover panel                                                                                                            |
| `hcf-symbol-white.png`        | Prepared but **not wired into `config`** — a white symbol-only asset, ready if a future surface needs a symbol (rather than the full lockup) on a dark background |
| `hcf-favicon.ico`             | `faviconPath`                                                                                                                                                     |

All four logo components (`ShelfSidebarLogo`, `ShelfMobileLogo`,
`ShelfSymbolLogo`, `ShelfFullLogo` in
[`app/components/marketing/logos.tsx`](https://github.com/Fudd2020/HCF-Production-Team-Stock/blob/main/apps/webapp/app/components/marketing/logos.tsx))
read from `config.logoPath` and set **height only** on the `<img>` — never a
width — so the browser preserves the source aspect ratio. If you swap in a
differently-proportioned logo, check it still fits the sidebar's ~228px of
available width at the rendered height (`ShelfSidebarLogo` expanded renders at
`h-[40px]`, the mobile header at `h-8`/32px).

### Palette — the Tailwind `primary` ramp

`apps/webapp/tailwind.config.ts` defines the brand palette under
`theme.extend.colors.primary`:

| Token                     | Hex                  | Rule                                                                                                                                                                         |
| ------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `primary.500` (`DEFAULT`) | `#FF4631`            | The brand accent — borders, icons, chart series, large text. 3.40:1 under white text, so it must **never** sit under white/near-white text.                                  |
| `primary.600`             | `#D93C2A`            | The **only** shade allowed under white text (4.55:1). Every solid button fill uses this, not `500`.                                                                          |
| `primary.700`–`900`       | darkening            | Hover / active / pressed states on a `600` surface.                                                                                                                          |
| `primary.25`–`400`        | a genuine light ramp | Tints, hover backgrounds, badges. `400` is a tint only — never a button hover state, because a hover that _lightens_ under white text is exactly the bug this ramp replaces. |
| `canvas`                  | `#FFFBF8`            | The warm off-white page background (`body` in `app/styles/global.css`).                                                                                                      |

`500` and `600` are **pinned** — they are Neil's brand decisions, not
generated. The rest of the ramp is generated to genuinely darken/lighten from
those two anchors. If you ever need to change the accent colour, keep this
500-for-fills / 600-for-white-text-fills split; collapsing them back to one
hex (as the upstream Shelf ramp did — `DEFAULT`/`500`/`600`/`700` were all the
same `#EF6820`) silently turns every hover and active state into a no-op.

Do not hardcode hex colours on `Badge` — see
[`app/utils/badge-colors.ts`](https://github.com/Fudd2020/HCF-Production-Team-Stock/blob/main/apps/webapp/app/utils/badge-colors.ts)
and the accessibility guide. **`BADGE_COLORS` is a known gap**: 4 of its 10
entries (orange, brown, amber, pink) fall short of 4.5:1 text contrast. This is
not a regression from the rebrand — the backgrounds are opaque, so the ratios
are unchanged from the old white-body Shelf theme — but it is not fixed
either. It needs a designer to supply replacement hexes.

## The focus-ring trap — where the ring colour lives matters

The coral focus ring shipped **broken** the first time, and the bug is subtle
enough to recur if you're not warned: it built, it passed lint and
`tsc`, and it rendered nothing visible wrong — the ring was just invisible.

**The rule:** focus-ring defaults must live in `theme.extend.ringColor` /
`ringOffsetColor` / `ringOpacity` inside `tailwind.config.ts`. They must
**never** be set as `--tw-ring-color` on `:root` in a stylesheet.

```ts
// apps/webapp/tailwind.config.ts
theme: {
  extend: {
    ringColor: { DEFAULT: "#D93C2A" },       // 4.41:1 against the canvas
    ringOffsetColor: { DEFAULT: "#FFFBF8" },
    ringOpacity: { DEFAULT: "1" },           // see below — this line matters too
  },
}
```

Why `:root` doesn't work: Tailwind's preflight base layer emits
`*, ::before, ::after { --tw-ring-color: rgb(59 130 246 / 0.5) }` — a
declaration applied **directly to every element**. A value merely _inherited_
from `:root` loses to a value set directly on the element, every time. So a
`:root { --tw-ring-color: #d93c2a }` rule is silently inert, and any control
whose only focus style is a bare `focus-visible:ring-2` (the shared `Button`
component, for example) painted Tailwind's default blue instead.

The second half of the trap: **`ringOpacity.DEFAULT` is `0.5`** out of the
box, and it applies to `ringColor.DEFAULT`. Setting `ringColor` alone renders
the ring at 50% opacity — `rgb(217 60 42 / 0.5)`, which composites down to
roughly `#EC9C91` against the warm canvas, measuring **2.10:1** — still short
of the 3:1 WCAG 2.1 SC 1.4.11 requires of a focus indicator. You have to also
set `ringOpacity.DEFAULT` to `"1"` to get a solid ring. This was only caught by
reading `getComputedStyle` on a keyboard-focused button in a real browser —
neither Vitest nor `tsc` can see a CSS custom property losing to specificity,
or an opacity default halving a colour's contrast.

## Emails

`config.emailPrimaryColor` (`#D93C2A`) is consumed by
[`app/emails/styles.ts`](https://github.com/Fudd2020/HCF-Production-Team-Stock/blob/main/apps/webapp/app/emails/styles.ts)
as the CTA button fill/border, and by a handful of templates as an inline text
colour. `app/emails/logo.tsx` reads `config.logoPath.fullLogo` for the header
image and `config.appName` for its `alt` text — check this file specifically
if you ever change `logoPath`, since it renders through `${SERVER_URL}` rather
than a relative path (the recipient's mail client has no access to your dev
server, so `SERVER_URL` must be a publicly reachable URL in production).

`app/emails/stripe/*` is **not** rebranded — it is unreachable while
`ENABLE_PREMIUM_FEATURES=false` and was deliberately left out of scope. If this
instance ever turns premium features on, that template set will need the same
sweep.

## Progressive Web App manifest

`apps/webapp/public/static/manifest.json` is a **hand-edited static file**,
not generated from `config.appName`. Generating it would need a resource
route and a new caching story for already-installed PWAs, for a value that
changes essentially never. Instead, `app/config/manifest.test.ts` imports the
JSON and asserts `name` matches `config.appName` — so if you rename the app in
`shelf.config.ts` without updating the manifest, that test fails and tells you
to fix it.

`short_name` is **not** pinned to `config.appName` — it is its own literal,
`"HCF Stock"`. Home-screen icons truncate at roughly 12 characters, and the
full name "HCF Production Stock" would render as "HCF Product…" on a phone.
Update it by hand if the app is ever renamed.

If you change the icon or theme colours, note that **already-installed PWAs
cache the old manifest** — a device that installed this app before a manifest
change keeps the old icon/name until it's removed and re-added.

## The AGPL obligation

This repository is licensed AGPL-3.0 (see `LICENSE` at the repository root).
Section 13 requires that anyone who interacts with a modified version of the
software **over a network** be offered the Corresponding Source — running a
private fork on a server is exactly that case, even though nobody is
"distributing" the software in the traditional sense.

`config.sourceRepositoryUrl` is the single field this depends on:

```ts
// apps/webapp/app/config/shelf.config.ts
sourceRepositoryUrl: "https://github.com/Fudd2020/HCF-Production-Team-Stock",
```

It is a **non-optional `string`** in `Config` — deliberately, because a
nullish value bound to a link renders a silently dead control that neither
`tsc` nor unit tests catch (see the `resolve-nullish-button-to` engineering
rule referenced at the field's own JSDoc).

The link is offered in two places, both carrying a `LEGALLY REQUIRED — do not
remove` comment so a future "strip Shelf references" sweep doesn't take it out
by mistake:

- **Signed in** — "About & source code" in the sidebar user menu
  (`app/components/layout/sidebar/sidebar-user-menu.tsx`). This menu is
  deliberately ungated: every organisation role, including `SELF_SERVICE`, can
  reach it in two clicks from any authenticated screen.
- **Signed out** — a "Based on Shelf.nu · AGPL-3.0" line under the login form
  (`app/routes/_auth+/_auth.tsx`), for anyone who never signs in.

Both say **"Based on Shelf.nu"**, not "by Shelf" — accurate attribution
without implying endorsement.

**Maintenance note — this points at the repository root, not a release tag.**
The fork currently has no published GitHub releases, so a tag URL would land a
user on "There aren't any releases here yet", a worse offer than the
repository itself. The comment at `sourceRepositoryUrl` in `shelf.config.ts`
says to switch to
`https://github.com/Fudd2020/HCF-Production-Team-Stock/releases/tag/<tag>` the
moment a release exists — a tagged release keeps the published source in step
with whatever build is actually deployed, which the default branch does not
guarantee once the fork diverges further from upstream.

## What is deliberately NOT covered by this rebrand

- **Dark mode.** The app is light-theme only; dark mode touches roughly 200
  files and was explicitly deferred as its own project.
- **`BADGE_COLORS` accessibility** — see the palette section above. Not fixed,
  not a regression, needs a designer.
- **The 35 Apple splash screen images** in `public/static/splash_screens/` are
  still solid Shelf-orange with the Shelf mark. Their `<link>` tags were
  removed from `root.tsx`, so an installed iPad PWA now falls back to the
  manifest's `background_color` instead of showing them — but the files
  themselves were left on disk (with a `// why:` comment) for a future asset
  swap rather than regenerated, since nobody has scoped that design work.
- **The iOS "Install App" Smart App Banner was removed outright**, not
  rebranded. `app/root.tsx` used to ship
  `<meta name="apple-itunes-app" content="app-id=6765639874">`, which pointed
  at Shelf's own Companion app in Shelf's own App Store account — a volunteer
  tapping "Install" would have installed an app that cannot see this
  instance's equipment at all. If HCF ever ships its own companion app under
  its own App Store listing, this is a one-line addition with the new app id.
