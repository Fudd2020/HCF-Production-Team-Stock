---
description: Client code must use randomClientId() from ~/utils/id, never crypto.randomUUID() — the latter is secure-context-only and is undefined on a phone hitting a LAN dev server over http, where it throws during render and kills hydration for the whole app
globs: ["apps/webapp/app/**/*.ts", "apps/webapp/app/**/*.tsx"]
---

# Client Code Uses `randomClientId()`, Never `crypto.randomUUID()`

`crypto.randomUUID()` is exposed **only in a secure context** — HTTPS or
`localhost`. It is `undefined` over plain `http://` on a LAN address, which is
exactly how a phone reaches a dev server (`http://192.168.1.x:3000`).

**The failure is total, not local.** Calling it during render throws
`TypeError: crypto.randomUUID is not a function`. That killed hydration for the
entire app, and because `_layout.tsx` gates every authenticated route on
`useHydrated`, the only symptom was the **"Activating workspace…" spinner
never resolving**. No error on screen, nothing in the server log — it looks
like a hang, not a crash. It shipped in four call sites.

```ts
// ❌ Bad — undefined on any phone hitting the dev server over http
const key = crypto.randomUUID();

// ❌ Also bad — a local guard. This is a repo-wide convention, not a per-file one
const key =
  typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : fallback();

// ✅ Good — one shared helper, used everywhere in client code
import { randomClientId } from "~/utils/id";
const key = randomClientId();
```

`randomClientId()` prefers `crypto.randomUUID()`, falls back to
`crypto.getRandomValues()` — which has **no** secure-context requirement, so
the fallback is still a cryptographically sound UUID v4 — and only then to a
last-resort string, so it can never be the thing that throws.

**`*.server.ts` may use `crypto.randomUUID()` freely** — Node always provides
it. Current legitimate server call sites: `modules/scim/service.server.ts`,
`modules/asset/service.server.ts`, `modules/kit/service.server.ts`.

## The sibling you cannot fix in code

`getUserMedia` (the QR/barcode scanner) is secure-context-only too — but there
is **no fallback**, because a browser withholding the camera from an insecure
page is correct behaviour. Do not add a workaround. Testing the scanner on a
phone needs an HTTPS tunnel; `vite.config.ts` already allowlists
`.trycloudflare.com`, with `DEV_ALLOWED_HOSTS` for others. Setup is in
`apps/docs/local-development.md` — link to it, don't restate it.

Both disappear in production, where everything is HTTPS. This is a
**local-dev-only** class — which is why it reaches `main` so easily.

Pinned by `app/utils/id/random-client-id.test.ts`, which removes the APIs the
way an insecure context does.
