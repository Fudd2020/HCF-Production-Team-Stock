# Requirements — folder convention & agent handoff protocol

This folder is the **shared workspace for the Shelf delivery agent team**. It is
the only place those agents record what a feature is, who is doing what, and
what the next agent must pick up.

Everything in here except this file and `.gitignore` is **git-ignored** — these
are local working artifacts, not repository documentation. Product docs that
should ship live in `apps/docs/`; engineering rules live in `.claude/rules/`.

---

## 1. Folder structure — one folder per feature

```
Requirements/
├── .gitignore
├── README.md                          ← this file (the protocol)
└── <feature-slug>/                    ← one folder per FEATURE, kebab-case
    ├── feature.md                     ← the feature brief (BA writes)
    ├── DECISIONS.md                   ← APPEND-ONLY log of what the user decided
    ├── progress.md                    ← THE HANDOFF BATON (every agent updates)
    ├── US-001-<slug>.md               ← user stories, all in the feature folder
    ├── US-002-<slug>.md
    ├── design.md                      ← UX designer, if the feature has UI
    ├── test-plan.md                   ← QA writes, after stories exist
    └── release-plan.md                ← release manager, before shipping
```

Rules:

- `<feature-slug>` is kebab-case and stable — it never gets renamed once work
  starts, because `progress.md` links and agent handoffs reference it.
- **All user stories for a feature live directly in that feature's folder.** No
  nested `stories/` directory, no stories at the `Requirements/` root.
- Story IDs are `US-NNN`, zero-padded, unique **within the feature**, and never
  reused — if a story is dropped, mark it `DROPPED` in `progress.md` rather than
  recycling the number.

---

## 2. The team

| Agent                       | Owns                                             | Writes in               |
| --------------------------- | ------------------------------------------------ | ----------------------- |
| `shelf-business-analyst`    | Feature brief, user stories                      | `Requirements/` only    |
| `shelf-tech-lead`           | Breakdown, assignment, contracts, sign-off       | `Requirements/` only    |
| `shelf-ux-designer`         | Interaction design, states, copy, a11y spec      | `Requirements/` only    |
| `shelf-database-specialist` | Schema, migrations, indexes, triggers, backfills | `packages/database/`    |
| `shelf-backend-dev`         | Services, loaders/actions, validation, events    | `apps/webapp/`          |
| `shelf-frontend-dev`        | Components, screens, forms                       | `apps/webapp/`          |
| `shelf-companion-dev`       | Expo/React Native mobile app                     | `apps/companion/`       |
| `shelf-qa`                  | Test plan, automated coverage, verdict           | tests + `Requirements/` |
| `shelf-tech-writer`         | User & developer documentation                   | `apps/docs/`            |
| `shelf-release-manager`     | Release readiness, rollout plan, CI/CD           | `.github/`, `fly.toml`  |

**Pre-existing agents this chain calls into** (they are not new — wire them in
rather than duplicating what they do):

| Agent / skill              | When the chain uses it                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `shelf-security-reviewer`  | **Mandatory** after backend work touching auth, permissions, org-scoping/IDOR, redirects, uploads, secrets or billing — before QA passes it |
| `/pr-review-loop` (skill)  | After Neil opens the PR — handles CodeRabbit/Codex/Copilot feedback                                                                         |
| `shelf-pr-comment-triager` | Invoked by that skill, one per finding                                                                                                      |
| `sentry-triage`            | Post-release: production errors feed back to the BA/tech lead as new work                                                                   |

## 3. The handoff chain

```
   ┌──────── Neil (business input, decisions, approvals, all commits & deploys)
   │
   ▼
 shelf-business-analyst ──▶ feature.md + US-*.md + progress.md
   │  READY_FOR_TL
   ▼
 shelf-tech-lead ──▶ breakdown, assignees, contracts, sequencing
   │  READY_FOR_DEV
   ├──▶ shelf-ux-designer ──▶ design.md          (any story with new UI)
   │
   ├──▶ shelf-database-specialist ──▶ migration   (FIRST, if schema changes)
   │         │
   │         ▼
   ├──▶ shelf-backend-dev ──▶ services, loaders/actions
   │         │
   │         ├──▶ shelf-security-reviewer   (MANDATORY if security-sensitive)
   │         ▼
   ├──▶ shelf-frontend-dev ──▶ screens        (builds to the contract + design)
   │
   └──▶ shelf-companion-dev ──▶ mobile        (only if in scope — see below)
             │  CODE_COMPLETE
             ▼
 shelf-qa ──▶ test-plan.md + automated tests
   │  QA_PASSED   (or BLOCKED back to the owning dev)
   ▼
 shelf-tech-writer ──▶ apps/docs + sidebar entry
   │
   ▼
 shelf-release-manager ──▶ release-plan.md, GO / NO-GO
   │
   ▼
 shelf-tech-lead ──▶ DONE, hands back to Neil
   │
   ▼
 Neil commits, opens PR ──▶ /pr-review-loop ──▶ merge = deploy
   │
   ▼
 sentry-triage (post-release) ──▶ new defects re-enter at the BA or tech lead
```

### Ordering rules that matter

- **Schema first.** If a story needs a migration, `shelf-database-specialist`
  goes before `shelf-backend-dev` — the backend builds on the new shape.
- **Backend before frontend** whenever a story needs both, so the frontend
  builds against a real contract rather than a promised one.
- **Design before frontend.** `shelf-ux-designer` runs in parallel with backend
  work; it only blocks the frontend dev.
- **Security review before QA passes**, not after. A story with security-
  sensitive backend work cannot reach `QA_PASSED` without it.
- **Companion work is opt-in.** `CLAUDE.md` notes the mobile app is owned by
  another team — the tech lead must confirm with Neil before assigning it.

**No agent skips a link.** If the frontend dev finds the API contract is wrong,
it does not fix the backend — it sets the story `BLOCKED`, names
`shelf-backend-dev` as the next owner, and stops. The same applies in every
direction: work bounces back to the specialist who owns that layer.

---

## 4. `progress.md` — the handoff baton

Every feature folder has exactly one `progress.md`. **Every agent reads it
first and rewrites it last.** It is the only mechanism the agents have to pass
context — they do not share a conversation.

Copy this template verbatim:

```markdown
# Progress Plan — <Feature Name>

**Feature slug:** <feature-slug>
**Status:** DRAFTING
**Next agent:** shelf-tech-lead
**Last updated by:** shelf-business-analyst — <YYYY-MM-DD>

## Handoff — READ THIS FIRST

**To:** shelf-tech-lead

**What I just did:**

- <bullet per meaningful output, with file paths>

**What you must do next (be specific — this is the whole point of this file):**

1. <concrete, ordered, unambiguous instruction>
2. <...>

**Do NOT:**

- <scope guards: things the next agent must not touch or decide>

**Blockers / open questions:**

- <or "None">

**Files touched this handoff:**

- <path> — <one-line why>

## Story board

| Story  | Title | Assignee          | Status | Depends on | Automated tests |
| ------ | ----- | ----------------- | ------ | ---------- | --------------- |
| US-001 | ...   | shelf-backend-dev | TODO   | —          | none yet        |

## Decision log

| Date       | Agent           | Decision | Why |
| ---------- | --------------- | -------- | --- |
| YYYY-MM-DD | shelf-tech-lead | ...      | ... |

## Open questions for Neil

- [ ] <question> — _blocking US-00N_
```

### Feature `Status` values

| Status               | Meaning                                               | Next agent              |
| -------------------- | ----------------------------------------------------- | ----------------------- |
| `DRAFTING`           | BA still writing the brief/stories                    | shelf-business-analyst  |
| `READY_FOR_TL`       | Stories written and acceptance criteria testable      | shelf-tech-lead         |
| `READY_FOR_DEV`      | Stories assigned, sequenced, contracts defined        | the named specialist    |
| `IN_DESIGN`          | UX design in progress (may overlap backend work)      | shelf-ux-designer       |
| `IN_PROGRESS`        | At least one story being implemented                  | the named specialist    |
| `IN_SECURITY_REVIEW` | Security-sensitive work awaiting review               | shelf-security-reviewer |
| `IN_QA`              | All in-scope stories `CODE_COMPLETE`                  | shelf-qa                |
| `IN_DOCS`            | QA passed; documentation outstanding                  | shelf-tech-writer       |
| `READY_FOR_RELEASE`  | Documented; awaiting go/no-go                         | shelf-release-manager   |
| `BLOCKED`            | Work cannot proceed — blocker is named in Handoff     | whoever can unblock     |
| `NEEDS_INPUT`        | Waiting on Neil — see _Open questions_                | Neil                    |
| `DONE`               | QA passed, released or release-approved, TL closed it | Neil                    |

Skipping a stage is allowed when it genuinely doesn't apply (a copy-only change
needs no security review), but the tech lead must say so explicitly in the
handoff. Silent omission is how a stage stops happening at all.

### Story `Status` values

`TODO` → `IN_PROGRESS` → `CODE_COMPLETE` → `IN_QA` → `QA_PASSED` → `DONE`,
plus `BLOCKED` and `DROPPED` at any point.

Only **QA** may set `QA_PASSED`. Only the **tech lead** may set `DONE`.

---

## 5. Hard rules for every agent in this chain

1. **Read before writing.** Read `DECISIONS.md` first, then `progress.md`, then
   `feature.md`, then the stories you own. Never act on the handoff summary
   alone.
2. **Rewrite the whole `## Handoff` block** — do not append to it. It describes
   the _current_ baton pass, not a history. History belongs in the decision log.

### 4a. Write state to files AS YOU GO — never hold it in conversation

The files in this folder are the project's memory. Conversation is not: it is
expensive to re-read, it is lost between sessions, and no other agent can see
it. Anything a future agent (or a future you) would need to know goes in a file
**at the moment you learn it**, not at handoff time.

- **`DECISIONS.md` is APPEND-ONLY and authoritative.** `progress.md` is
  rewritten at every handoff, so a decision recorded only there gets diluted or
  lost as the baton passes. The moment the user decides something, append it to
  `DECISIONS.md` with the date and which stories it affects. Never rewrite,
  reorder or "tidy" existing rows — supersede them with a new row that says
  what it supersedes.
- **Update `progress.md` incrementally.** Do not do all the work and then write
  the file once at the end. Mark a story `IN_PROGRESS` when you start it and
  `CODE_COMPLETE` when you finish it. If you are interrupted, run out of
  context, or fail, the next agent must be able to see exactly how far you got.
- **Record findings where they will be found**, not in your final message. A
  discovery that only exists in a message to the user is lost the moment the
  conversation moves on. If it changes what someone should do, it goes in a
  file.
- **Never make the user repeat themselves.** If you find yourself about to ask
  something already answered, the answer was not written down properly — fix
  that as well as answering.

3. **Never invent business requirements.** If a requirement is unclear, add it
   to _Open questions for Neil_, set `NEEDS_INPUT`, and stop. Guessing at
   business rules is the single most expensive failure mode in this chain.
4. **Never commit or push.** `CLAUDE.md` forbids staging or committing without
   Neil asking. Agents leave the working tree dirty and say so in the handoff.
5. **Requirements-only agents write only inside `Requirements/`.** The BA and TL
   never edit application code. Devs and QA never edit `feature.md` or
   `US-*.md` — if a story is wrong, they raise it in the handoff and let the BA
   correct it.
6. **`.claude/rules/` outranks your own judgment.** Every rule file there was
   written after a production incident. Read the ones relevant to what you touch.
7. **Stay in scope.** The story's acceptance criteria are the deliverable. Extra
   refactors go in the decision log as a suggestion, not in the diff.

---

## 6. Shelf domain facts every agent needs

Shelf is a **multi-tenant asset management platform**. These are not optional
details — they belong in every story and every implementation:

- **Every entity is org-scoped.** `organizationId` isolates tenants. Any ID that
  arrives from request/form input must be proven to belong to the caller's org
  before use — see `.claude/rules/org-scope-user-supplied-ids.md`. A story that
  doesn't state its org-scoping is not ready for development.
- **Org roles** (`OrganizationRoles`): `OWNER`, `ADMIN`, `BASE`, `SELF_SERVICE`.
  Every story states which roles can do the thing. `SELF_SERVICE` and `BASE`
  users are heavily restricted — assume nothing.
- **Instance roles** (`Roles`): `USER`, `ADMIN` (Shelf staff admin panel).
- **Tiers** (`TierId`): `free`, `tier_1`, `tier_2`, `custom`. If a feature is
  paid-only, the story must say so — gating is enforced server-side.
- **Core entities:** Asset, Kit, Booking, Location, Category, Tag, Custody,
  QR code, Barcode, Audit, Team member, Custom field, Asset model, Reminder.
- **Two clients** consume the backend: `apps/webapp` (Remix) and
  `apps/companion` (Expo/React Native). A backend change may affect both. The
  companion app is owned by another team — coordinate, don't assume.
