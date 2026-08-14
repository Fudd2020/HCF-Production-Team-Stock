# Deployment — Render 🎨

This is the deployment path **HCF Production Stock actually uses**. It runs the
app on Render's free plan, with Supabase continuing to provide the database,
auth and file storage.

For the upstream Fly.io path — still fully configured in `apps/webapp/fly.toml`
and `.github/workflows/deploy.yml`, and the intended destination if this ever
outgrows the free plan — see [Deployment](./deployment.md).

---

## Why Render, and what it costs you 💷

Render's free plan was chosen deliberately over Fly.io's ~£5/month, with the
plan to move to Fly if usage grows. That trade is real and worth understanding
before the first Sunday it matters.

|                       | Free plan behaviour                                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Idle spin-down**    | The service stops after ~15 minutes with no requests                                                                                                                                                        |
| **Cold start**        | The next request waits for a full container boot. This image needs a 90-second health-check grace on Fly, so expect **tens of seconds**, not milliseconds                                                   |
| **Live toasts (SSE)** | `/api/sse/notification` is a long-lived connection. It dies on spin-down and reconnects on the next page load. Toasts are cosmetic, so nothing is lost — but they will not fire while the service is asleep |
| **Build time**        | The whole monorepo builds in the container (turbo prune → install → build). Expect **10–15 minutes** per deploy                                                                                             |

**The practical shape of this:** the first person to open the app on a Sunday
morning waits. Everyone after them does not. If that becomes the thing people
complain about, that is the signal to move to Fly — not a bug to debug.

> 💡 **A warm-up trick, if the wait bites.** Hitting `/healthcheck` from an
> external uptime pinger every 10 minutes keeps the service awake. Render's free
> plan has a monthly instance-hour budget, so a 24/7 pinger can exhaust it —
> schedule it for Sunday mornings and midweek rehearsal, not around the clock.

---

## Prerequisites ✅

- ✅ A **Supabase project** with the schema already migrated
- ✅ Working **SMTP credentials** — invites are email, so this is not optional
- ✅ The code you want live merged to **`main`**
- ✅ A **Render account** (no card needed for the free plan)

---

## Step 1 — Run migrations FIRST 🗄️

**Before every deploy that contains a schema change**, and always from a
developer machine:

```bash
cd packages/database
npx prisma migrate deploy
```

Check the datasource line it prints. `"postgres" … at "…pooler.supabase.com"`
is production; `"shelf_dev" … at "localhost:5432"` is local. Do not infer the
target from the migration count — both databases report "up to date".

### Why this is not automated

Render's `preDeployCommand` is a **paid** feature. The alternative — putting
`prisma migrate deploy` in the container entrypoint — would run it on every cold
start, and on the free plan that is many times a day, adding to a boot that is
already the slowest part of the experience.

Running migrations by hand is also the **correct order**, not just a workaround.
Migrations here are expand-only, so the new schema is applied while the old code
is still serving and the old code simply ignores it. Deploying code first would
break every surface that reads the new column.

---

## Step 2 — Create the service 🚀

The repo contains a [Blueprint](../../render.yaml), so Render can read the whole
service definition rather than you filling in a form.

1. Render Dashboard → **New** → **Blueprint**
2. Connect the GitHub repo (`Fudd2020/HCF-Production-Team-Stock`)
3. Render finds `render.yaml` and shows one web service, `hcf-production-stock`
4. It prompts for every `sync: false` variable — see the next step
5. **Apply**

`SESSION_SECRET` and `INVITE_TOKEN_SECRET` are `generateValue: true`, so Render
mints them itself. You never see or need them.

---

## Step 3 — Environment variables 🔑

Copy these from your root `.env`. Everything not listed has a default in the
Blueprint.

| Variable                | Notes                                          |
| ----------------------- | ---------------------------------------------- |
| `DATABASE_URL`          | Supabase **pooled** connection, port **6543**  |
| `DIRECT_URL`            | Supabase direct connection, port **5432**      |
| `SUPABASE_URL`          | e.g. `https://<ref>.supabase.co`               |
| `SUPABASE_ANON_PUBLIC`  | Public by design — ships in the browser bundle |
| `SUPABASE_SERVICE_ROLE` | **Server-only. Never expose this.**            |
| `SERVER_URL`            | Set **after** step 4, once the hostname exists |
| `ADMIN_EMAIL`           | This address becomes the super admin           |
| `SUPPORT_EMAIL`         | Shown in the UI                                |
| `SMTP_*`                | Host, port, user, password, from-address       |
| `FINGERPRINT`           | Any stable string                              |

> ⚠️ **Use the pooled URL (6543) for `DATABASE_URL`.** The app opens many
> short-lived connections; pointing it at the direct port exhausts Supabase's
> connection limit and the app starts failing under ordinary load.

---

## Step 4 — Point the URL at itself 🔗

Render assigns something like `https://hcf-production-stock.onrender.com` on the
first deploy. Two places must then learn about it, and **both are silent
failures if missed**:

1. **`SERVER_URL`** in Render → set it to that exact URL, no trailing slash.
   It builds invite and password-reset links; wrong value means emails whose
   links go nowhere. Changing it redeploys the service.

2. **Supabase → Authentication → URL Configuration** → add the URL to
   **Redirect URLs** (and set **Site URL**). Miss this and login appears to work
   but the callback is rejected.

Adding a custom domain later (e.g. `stock.hcfchurch.uk`) means repeating both.

---

## Step 5 — First login 👤

`DISABLE_SIGNUP=true`, so nobody can self-register — by design (ROADMAP §5.1).
The first account is the one matching `ADMIN_EMAIL`; everyone else arrives by
invitation from inside the app.

---

## Deploying afterwards 🔄

`autoDeploy: true` on `main`. Push to `main` and Render rebuilds.

**If the push includes a migration, run step 1 first.** There is no automation
guarding that ordering — it is a discipline, and it is the single thing most
likely to cause an outage here.

---

## Moving to Fly.io later ✈️

Nothing in this setup blocks it, and nothing needs undoing:

- `apps/webapp/fly.toml` — bluegreen strategy, `min_machines_running = 1` (no
  spin-down, which is precisely what you would be buying), and
  `release_command = npx prisma migrate deploy`, which removes the manual
  migration step above
- `.github/workflows/deploy.yml` — the automated pipeline, already written
- The same Docker image builds on both

The move is: create the Fly app, copy the environment variables across, deploy,
repoint DNS. Render can then be deleted. The database never moves — it is on
Supabase in both cases.

**The signal to move** is people noticing the wait, not a metric threshold.

---

## Troubleshooting 🔧

| Symptom                                    | Cause                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| First request of the day hangs, then works | Cold start. Expected on the free plan — see the warm-up note above                                              |
| Login redirects to an error                | The Render URL is not in Supabase's Redirect URLs (step 4.2)                                                    |
| Invite emails link somewhere wrong         | `SERVER_URL` is unset, stale, or has a trailing slash                                                           |
| 500s on asset pages after a deploy         | A migration was not applied first. Run step 1                                                                   |
| "too many connections"                     | `DATABASE_URL` is on port 5432 instead of the pooled 6543                                                       |
| Build fails or times out                   | The monorepo build is heavy; check the Render build log for an OOM and consider the prebuilt GHCR image instead |
| Toasts stop appearing                      | The SSE connection dropped on spin-down. A page reload restores it                                              |
