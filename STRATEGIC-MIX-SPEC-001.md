# STRATEGIC-MIX-SPEC-001 — Canonical Product Specification

**Status: CANONICAL.** This document is the single source of truth for Strategic Mix. Every
subsequent implementation phase (P1+) MUST conform to it; deviations require a versioned
amendment to this spec, never a silent divergence. Companion evidence base:
`CAMPAIGN-AUDIT-001/002/003/004.md`. **This phase (P0.5) changes no production behavior, no
routing, no APIs, no schema, no business logic.**

---

## 0. Definition

**Strategic Mix is not a campaign generator. Strategic Mix is the Campaign Operating System.**

The three BOLT modes (Text, Creator, Intelligent Mix) are *generators*: one form → one AI run →
one finished campaign. Strategic Mix is the *system of record and control* in which a campaign is
planned, assembled, reviewed, and released — by hand, with AI assistance, or both, in any order.

The defining act: **the moment a user enters Strategic Mix, a Draft Campaign exists.** Every
subsequent artifact — structure decisions, content, assignments, schedules — belongs to that
Draft Campaign from birth. Nothing of durable value may live only in browser session state
(the audited failure of the current canonical route: tab-scoped `sessionStorage`,
AUDIT-004 §7.3).

---

## 1. Core Entities & Ownership

Eight entities. Each has exactly one owner of truth. An entity never reaches into another's
responsibility; all cross-entity relationships flow through **Assignment**.

| Entity | What it is | Owns | Must never own | Today's substrate (mapping, not mandate) |
|---|---|---|---|---|
| **Campaign** | The root aggregate. Created immediately as Draft. | Identity, lifecycle stage, membership of everything below, audit trail | Structure details, content bodies, schedule times | `campaigns` row (`status='draft'`) + `campaign_versions` snapshot |
| **Structure** | The campaign's logistics architecture | Platforms & channel participation, duration & weeks, cadence & frequency, time windows & posting logic, approval rules | Any content body, any asset, any assignment | Blueprint layer: `campaign_week_plan` (draft→committed), skeleton in planner session |
| **Content** | The campaign's creative material, as a *collection* | Briefs, drafts, generated bodies; per-item creative lifecycle | Placement (when/where it runs), structure decisions | `daily_content_plans.content` today; Library assets + campaign-scoped drafts under this spec |
| **Asset** | One versioned creative unit (post, carousel, banner, image, infographic, blog, article, thread, document, video-guidance) | Its own body, versions, metadata/tags, render artifacts | Its schedule, its platform binding (that is Assignment's) | `creator_assets` (+ attachments), `blogs`, `content_assets` |
| **Assignment** | The explicit, editable link: one Content/Asset item ↔ one Structure slot (week, day, platform, window) | The relationship itself: create, edit, move, detach, approval state of the link | Content bodies, structure definitions | **The missing primitive** (AUDIT-004 §8) — to be introduced in P3 |
| **Schedule** | The materialization of confirmed Assignments into concrete publish times | Time computation, floors ("never in the past"), conflict resolution, queue entries | Content mutation of any kind | `structuredPlanScheduler` lanes → `scheduled_posts` |
| **Publishing** | Execution of scheduled items against external platforms | Delivery, retries, outcome recording | Anything upstream | publish queue workers, platform adapters |
| **AI Assistants** | Per-workspace optional helpers | Proposals and drafts, applied only on explicit user action | Any autonomous mutation, any gate on manual work | `campaignAiOrchestrator` modes, `field-assist` pattern |

**Ownership axioms** (restated as law): *Campaign is the root entity. Structure never owns
content. Content never owns structure. Assignment owns relationships. Schedule owns time, never
content. Publishing owns delivery, never planning.*

---

## 2. Canonical Campaign Lifecycle

```
 Draft ──► Planning (Structure ⇄ Content, UNORDERED) ──► Alignment ──► Board (Review)
                                                                          │
        ◄───────────────── re-entry allowed from every later stage ───────┘
                                                                          ▼
                                             Scheduling ──► Ready ──► Executing ──► Completed
                                                  │                       │
                                                  └──── Paused ◄──────────┘        Archived
```

| Stage | Meaning | Allowed operations | Forbidden |
|---|---|---|---|
| **Draft** | Campaign exists, empty or partial | Everything: edit/delete campaign, work either workspace, invoke AI, save continuously (autosave is implicit — there is no "unsaved" state) | Publishing |
| **Planning** | Structure and/or Content being built — *no ordering between them* | All Draft ops; structure commit; asset creation/import from Library; AI build/refine per workspace | Forcing one workspace before the other; any lock |
| **Alignment** | Assignments being created/edited (asset ↔ slot) | Create/edit/move/detach assignments; capacity & conflict *advice* (never a hard block, cf. AUDIT-004 §14) | Content mutation via assignment; silent auto-assignment |
| **Board (Review)** | Master view: structure + content + links + timeline + readiness + conflicts + approvals + missing items | Everything remains editable; approvals granted/revoked; re-enter any workspace | Locking anything; hidden state |
| **Scheduling** | Assignments materialized to concrete times | Reschedule (time, day, week, platform — full moves); floor enforcement (now+1h); per-platform/day integrity invariants | Content edits *through* scheduling; whole-campaign freeze |
| **Ready** | All scheduled, none executing yet | Any change — this stage is fully reversible by definition | — |
| **Executing** | ≥1 item within its freeze window or actively publishing | Edit every item NOT frozen; pause campaign; per-item cancellation before its window | Editing an item inside its freeze window; retroactive edits to published items |
| **Completed / Archived** | All items terminal / user-archived | Read, duplicate-as-new-draft, report | Mutation |
| **Paused** | User halt from any post-Alignment stage | Everything editable again (items leave Ready); resume | Publishing while paused |

**Lock doctrine (replaces today's early freeze):** immutability is **per-item and time-scoped**,
never campaign- or blueprint-wide. The current rule — one `scheduled_posts` row freezes the whole
blueprint (`campaignBlueprintService.ts:83-92`) — is explicitly non-canonical for Strategic Mix.
The only locks permitted: (a) an item inside its publish freeze window, (b) an item with
`status='executing'`, (c) optimistic-concurrency versions. Everything else stays editable until
execution. *Every major operation remains reversible until execution.*

---

## 3. Workspaces

Four surfaces. The first two are peers; neither precedes the other.

### 3.1 Structure Workspace
- **Responsibility:** everything logistical — connected platforms, publishing destinations,
  frequency/cadence, content-type mix, platform allocations, time windows, posting logic,
  duration, approval rules, channel participation.
- **User freedoms:** build manually from blank; ask AI to draft a structure; refine either way;
  iterate indefinitely; save is continuous (Draft Campaign owns it).
- **AI here** (see §4): "draft a structure", "optimize cadence", "suggest channel mix" — output
  is an **editable skeleton**, never a read-only card (today's cards are read-only,
  AUDIT-004 §1).
- **Transitions:** to Content, Alignment, or Board at any time. Committing structure is a status
  marker, not a gate (`campaign-planner.tsx:111` precedent: "confirming is status-only").

### 3.2 Content Workspace
- **Responsibility:** create/edit/replace/delete/duplicate/version/organize every asset type —
  with or without structure existing.
- **Two sources, one collection:** (a) assets drafted inside the campaign; (b) assets imported by
  reference from the company **Library** (the server-backed, versioned asset store — P2). Import
  never copies-by-default; it references, so Library improvements propagate until an assignment
  pins a version.
- **User freedoms:** full CRUD + versioning + tags/organization; nothing here requires a
  structure or an assignment to exist.
- **AI here:** per-field assist (the `field-assist` contract), "draft asset from brief",
  rewrite/adapt-format — all explicit-invocation only.
- **Transitions:** anywhere, anytime.

### 3.3 Campaign Board (Stage-3 master surface)
- **Responsibility:** the single consolidated view — structure, content, assignments, timeline,
  schedule preview, readiness score, validation results, missing items, conflicts, approvals.
- **User freedoms:** everything remains actionable from here: jump into either workspace, edit an
  assignment inline, replace an asset, change schedule, grant/revoke approval.
- **The Board never owns state** — it renders the entities and dispatches operations to their
  owners.

### 3.4 Scheduling
- **Responsibility:** turn confirmed assignments into queue entries; enforce time floors and
  integrity invariants (≤1 item per platform per day; no duplicate content per platform —
  existing law, `WEEKLY_STRUCTURE_ARCHITECTURE.md`); write the **effective** time back to the
  plan of record (the overdue-badge lesson, commit `ed27b7af`).
- **User freedoms:** full-move rescheduling (time/day/week/platform), unschedule, pause.
- **Scheduling never locks the campaign prematurely** — it locks only the item entering its
  window.

**Allowed workspace transitions:** any → any, always. The only *soft* gate in the product:
the Board's "Proceed to Scheduling" action requires ≥1 assignment (there is nothing to
schedule otherwise). That is a logical precondition, not a workflow gate.

---

## 4. AI Contract

**Law: AI assists. AI never controls. AI never performs destructive operations automatically.**

Binding rules, everywhere in Strategic Mix:

1. **Explicit invocation only.** No AI call runs without a user action naming it. (Template:
   `field-assist.ts:14-17` — "AI never runs without an explicit request, and manual content is
   untouched unless its field was targeted.")
2. **Propose → user applies.** AI output lands as a *proposal state* (draft skeleton, suggested
   copy, suggested cadence) the user accepts, edits, or discards. Direct persistence of AI output
   is permitted only where the user's invoking action IS the apply (e.g., "rewrite this field").
3. **No interrogation gates.** The QA gather-phase (5 required questions + confirmation,
   `runGatherPhaseGate.ts:89-101`) may exist only INSIDE the opt-in "AI, build it for me" flow.
   It must never gate manual work or block a workspace. (The prefill bypass machinery already
   makes this a configuration choice — AUDIT-004 §6.9.)
4. **Additive by default; destructive only with confirmation.** AI may add/refine; regenerate-
   replacing user-touched material requires explicit per-item confirmation.
5. **Validators advise.** Capacity, platform-rule, and conflict validation surface as advice with
   an override path — never an un-overridable 422 inside Strategic Mix (contrast:
   `CAPACITY_VALIDATION_FAILED` today).

Per-surface behavior:

| Surface | AI may | AI may not |
|---|---|---|
| **Structure** | Draft full skeleton from a brief; optimize cadence/channels/flow; explain trade-offs | Commit structure; alter user-set fields without apply; require its questionnaire before manual editing |
| **Content** | Generate asset drafts; rewrite/improve fields; adapt formats; propose messaging | Overwrite manual edits unrequested; delete/replace assets; auto-publish |
| **Board** | Summarize readiness; flag conflicts/missing items; propose fixes ("this slot has no asset — draft one?") | Auto-apply fixes; change assignments |
| **Scheduling** | Suggest times/stagger; flag collisions | Move items; change schedules without apply |

**Existing primitives to reuse (not rebuild):** `generate_plan` w/ `prefilledPlanning` (structure
draft), `refine_day` / `platform_customize` (board actions), `field-assist` + per-type generators
(content), capacity validator (advice mode). All AI actions bill through existing credit actions.

---

## 5. State & Transition Specification

### 5.1 Campaign stage field
One canonical stage vocabulary (single column, CHECK-constrained when implemented):
`draft → planning → alignment → review → scheduling → ready → executing → completed`
(+ orthogonal flags: `paused`, `archived`). The three current status axes (`status`,
`current_stage`, `execution_status`/`blueprint_status` — AUDIT-004 §5) are to be *read through
one selector* immediately (P1) and consolidated physically later (P6). No new writer may invent
stage strings (today's `'blueprint_committed'` free-text problem).

### 5.2 Entity state machines (canonical minimums)
- **Structure:** `empty → drafting → committed` (committed = status marker; re-editing returns
  to drafting without destroying assignments; assignments referencing removed slots become
  `orphaned` and surface on the Board — never silently deleted).
- **Asset:** `brief → drafting → ready` (+ per-version history; creator lifecycle FSM values
  remain the render-lane detail underneath).
- **Assignment:** `proposed → confirmed → scheduled → frozen → executed`, with `orphaned` and
  `detached` exits. Only `frozen/executed` are immutable.
- **Approval (optional per company):** `not_required | pending | approved | rejected` — attached
  to Assignments (link-time) and/or pre-publish, using the routing rules' existing
  `PENDING_APPROVAL` readiness vocabulary.

### 5.3 Transition rules
- Every transition is user-initiated or a direct consequence of time (freeze window entry).
- Every transition is recorded (who/when/why) on the Campaign audit trail.
- Backward transitions are always legal except out of `executed/completed` items.
- Deleting a Draft Campaign deletes its owned artifacts; Library assets referenced by it are
  never deleted by campaign deletion (reference, not ownership).

---

## 6. UX Principles

1. **Two doors, no order.** Entry presents Structure and Content as equal peers; the UI must not
   number them, wizard them, or imply sequence.
2. **Always saved.** No save buttons for existence; a visible "Draft · saved" indicator. Session
   storage may only ever be a latency cache over the server draft.
3. **Nothing dead-ends.** Every screen offers the way back; generation/launch is never a
   navigation event that abandons context (today: launch navigates away and clears state).
4. **Board is home.** After first entry, the Campaign Board is the campaign's landing surface;
   workspaces open from it.
5. **Show the seams honestly.** Readiness, conflicts, missing items, and approval states are
   first-class Board panels, not console logs (validators already compute them — surface them).
6. **Progressive freedom, not progressive disclosure of locks.** As execution nears, the UI marks
   frozen items distinctly; everything else keeps full affordances.
7. **AI is a labeled guest.** Every AI proposal is visually attributed and dismissible; applying
   is always a distinct act.

---

## 7. Architecture Principles

1. **One engine.** Strategic Mix composes the existing pipeline stages — it does not add a fifth
   generator. (Historical failure mode to avoid: `weekly_content_refinements`, dead
   `IntelMixView`, inert `orchestration/` — AUDIT-004 §17.)
2. **Single write chokepoints stay single.** All plan-row writes continue through
   `executionPlannerService.saveWeekPlans`; Assignment operations extend that seam rather than
   bypass it.
3. **Stages become library calls.** Plan-draft (ai/plan), structure-commit, row-generation,
   scheduling are independently invokable (the standalone `runGenerateWeeklyStructure` entry is
   the precedent) — Strategic Mix orchestrates them per user intent; BOLT modes keep composing
   them as one run.
4. **Assignment is the only coupling point** between Structure and Content. No generation-time
   embedding of placement into content, no content references inside structure.
5. **Server truth, client cache.** Any state worth keeping lives behind an API before it lives in
   the browser (asset library localStorage becomes cache-only).
6. **Two-path parity is a test obligation.** Manual structure and AI structure must flow through
   the same commit + generation path; the existing characterization suites
   (`generateWeeklyStructureCharacterization`, orchestrator suite) are the enforcement mechanism
   and must be extended with every phase.
7. **The shadow `orchestration/` layer is not a dependency.** It may eventually become the
   canonical substrate; no Strategic Mix phase may block on or silently couple to it.
8. **Established platform law carries over unchanged:** user platform selection is the authority
   (commit `5276dfbf`); schedule floor now+1h with effective-time write-back (`ed27b7af`);
   scheduling integrity invariants; credit metering on AI actions.

---

## 8. Implementation Invariants (MUST-follow rules for P1+)

I-1. **Draft-first:** entering Strategic Mix creates the Campaign (Draft) before any other write;
     no artifact may be created ownerless or session-only.
I-2. **Campaign is the root entity**; all Strategic Mix artifacts carry its id from birth.
I-3. **Structure never owns content; Content never owns structure; Assignment owns the
     relationship.**
I-4. **Scheduling never mutates content** — it may only stamp effective placement/time onto the
     plan of record.
I-5. **AI never executes destructive operations automatically**; all AI writes trace to an
     explicit user action.
I-6. **Every major operation is reversible until execution**; irreversibility is per-item,
     time-scoped, and visible.
I-7. **No new persistence substrate** without amending this spec; extend
     `creator_assets`/`campaign_week_plan`/`campaign_versions`/links-table designs from
     AUDIT-004 §13.
I-8. **No workflow gates on manual work** — soft status markers only; the sole logical
     precondition is "≥1 assignment to schedule".
I-9. **All plan-row mutation flows through the existing write chokepoint** (extended, not
     forked); integrity invariants (per-platform/day, dedup, floors) are non-negotiable.
I-10. **Characterization before change:** any phase touching the audited giants runs their suites
     and updates snapshots deliberately (per the repo's governance contracts).
I-11. **Status vocabulary is closed:** new states require a spec amendment; free-text stage
     values are forbidden.
I-12. **Mode identity:** exactly one route may claim Strategic Mix; generator modes may not
     re-label themselves as it.

---

## 9. Future Phases Mapping (spec § → phase)

| Phase (AUDIT-004 §16) | Delivers spec sections | Gated by |
|---|---|---|
| **P0.5 (this)** | The contract itself | — |
| **P1 — Durable drafts** | §2 Draft stage, I-1/I-2, §5.1 read-selector | none |
| **P2 — Server asset library** | §1 Asset, §3.2 Library import, I-7 | P1 |
| **P3 — Assignment primitive + Alignment UI** | §1 Assignment, §2 Alignment, §5.2 assignment FSM, I-3/I-9 | P1 (P2 for library refs) |
| **P4 — Workspace AI assistants** | §4 full contract, §3.1/3.2 AI panels | P1 |
| **P5 — Board & approvals + lock softening** | §3.3, §2 lock doctrine, §5.2 approvals, I-6 | P3 |
| **P6 — Hygiene (continuous)** | §5.1 physical consolidation, I-11 | parallel |
| Routing cutover (from P0) | §0 identity, I-12 | product sign-off |

Out of scope for all phases here: `orchestration/` cutover; AUDIT-003's Master-Idea (Model B/C)
evolution — complementary, tracked separately, must not be coupled (§7.7, AUDIT-004 §18).

---

*STRATEGIC-MIX-SPEC-001 · canonical product contract · P0.5 deliverable · no production behavior
changed. Amendments: append-numbered (SPEC-002…) with a change log; silent divergence is a defect.*
