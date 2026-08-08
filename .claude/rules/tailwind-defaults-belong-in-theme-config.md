---
description: Tailwind-owned CSS custom properties (--tw-ring-color, --tw-ring-offset-color, …) cannot be set from :root — preflight sets them on `*`, which beats inheritance. Set them in theme.extend, and remember *Opacity.DEFAULT silently halves *Color.DEFAULT
globs:
  [
    "apps/webapp/tailwind.config.ts",
    "apps/webapp/app/styles/*.css",
    "apps/companion/tailwind.config.*",
  ]
---

# Tailwind Defaults Belong in `theme.extend`, Never `:root`

Tailwind's preflight emits its own defaults **directly onto every element**:

```css
*,
::before,
::after {
  --tw-ring-color: rgb(59 130 246 / 0.5);
  --tw-ring-offset-color: #fff;
}
```

A declaration applied to `*` **always beats a value merely inherited** from
`:root`. So setting a Tailwind-owned custom property in `global.css` is
**inert** — it changes nothing, silently, and the browser keeps painting
Tailwind's default. Nothing warns you: the variable is visibly "set" in
DevTools on `:root` and still ignored on the element.

This shipped. Every control whose only focus style was a bare
`focus-visible:ring-2` — including the shared `Button` in `primary`, `danger`
and `info` — painted Tailwind blue at **1.82:1** against the canvas while
`global.css` "set" the brand colour. The bug survived a designer, two
developers, and QA's first diagnosis.

## The second trap: `*Opacity.DEFAULT` applies to `*Color.DEFAULT`

Moving the value into `theme.extend` is **not sufficient on its own**.
`ringOpacity.DEFAULT` is `0.5`, and Tailwind applies it to `ringColor.DEFAULT`.
A solid 4.41:1 brand colour renders at half alpha, composites to 2.10:1, and
**still fails** WCAG 2.1 SC 1.4.11 (3:1 for focus indicators) — while looking
fixed. This is the same class for `divideOpacity`, `placeholderOpacity`, etc.

```ts
// ❌ Bad — inert. Preflight's `*` rule wins; the ring stays Tailwind blue.
// app/styles/global.css
:root { --tw-ring-color: #d93c2a; }

// ❌ Still bad — applies, but at ringOpacity.DEFAULT (0.5) → 2.10:1, fails AA
theme.extend.ringColor = { DEFAULT: "#D93C2A" };

// ✅ Good — Tailwind emits both into its own base layer; renders solid
theme.extend = {
  ringColor: { DEFAULT: "#D93C2A" },
  ringOffsetColor: { DEFAULT: "#FFFBF8" },
  ringOpacity: { DEFAULT: "1" },
};
```

**Verify in a browser, not by reading CSS.** The compiled base layer is not in
the file you edited, and a source grep cannot tell you which declaration won.
Read the _computed_ value on a focused element:

```js
getComputedStyle(el).getPropertyValue("--tw-ring-color"); // want `rgb(217 60 42)`, not `/ 0.5`
getComputedStyle(el).boxShadow; // the ring as actually painted
```

Pinned by `app/utils/brand-palette-contrast.test.ts` and
`test/e2e/branding.spec.ts`. See `apps/docs/branding.md`.
