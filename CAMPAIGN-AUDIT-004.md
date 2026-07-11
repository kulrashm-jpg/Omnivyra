# CAMPAIGN-AUDIT-004 — Strategic Mix: Architecture, Product, UX & Workflow Audit

**Read-only implementation audit.** Compares the CURRENT campaign module against the intended
Strategic Mix operating model (two independent workspaces — Structure / Content — with linking,
per-workspace AI assistants, a master campaign board, and non-locking scheduling). Grounded in
code (`file:line`) and in AUDIT-001/002/003. **No files were modified. No code is proposed.**

> **Headline: "Strategic Mix" does not exist as a distinct mode today — it is a label with an
> identity crisis. The two-workspace product you described already exists in embryo at
> `campaign-planner.tsx` (Skeleton/Strategy/Build tabs), but the canonical route sends users to
> the single-form BOLT Combined generator instead. ~70% of the required machinery exists;
> the missing 30% is concentrated in four primitives: standalone campaign content, an
> asset→campaign attach path, a server-backed asset library, and editable links.**

---

## 1. Current Implementation Overview

**"Strategic Mix" resolves to two different products depending on entry point:**

| Entry | Route | What the user gets |
|---|---|---|
| `unifiedCreationModel.ts:55` (`strategic-mix-campaign`) | `/command-center/bolt-combined-strategy` | The **BOLT Combined single-form generator** — same page as Intelligent Mix (`:54`) |
| Campaign hub card "Strategy Mix" (`pages/command-center/campaigns.tsx:109`) | `/campaign-planner?mode=direct` | The **multi-tab planner** — Skeleton \| Strategy \| Build & Launch \| Design System (`campaign-planner.tsx:146-199`) |

- **BOLT Combined** (`bolt-combined-strategy.tsx` → `BoltCombinedStrategyMain` + `BoltCombinedStrategyController`)
  is one long form (topic, goals, audience, tone, focus, offerings, formats+frequency, duration,
  platforms, sharing, start date) → one AI call produces 3 strategy cards fusing structure AND
  content → confirm modal → `POST /api/bolt/execute` → fixed 6-stage pipeline → navigate away.
  Structure is a **read-only preview** inside the cards (`BoltCombinedStrategyController.tsx:185-201`).
- **campaign-planner** already separates Structure (Skeleton tab: `SkeletonBuilderPanel` +
  `PlanningCanvas`, `campaign-planner.tsx:203-227`) from Content (Strategy tab: plan/AI-chat/week
  panels + `StrategicThemeCards` + `WeekDailyPlanPanel`, `:230-346`), with **soft gating**:
  both tabs work independently; Build & Launch unlocks when both are ready
  (`canBuild = hasSkeletonDraft && themesReady`, `:112`, Lock icon `:186`); "confirming is
  status-only, never a gate" (`:111`). State = `PlannerSessionProvider` (`:58,479-506`), loaded
  from `/api/campaigns/retrieve-plan` (`:488`).
- Intelligent Mix is no longer a separate engine: `intelligent-mix-strategy.tsx:182-184` renders
  `<BoltCombinedStrategyPage/>`; `IntelMixView.tsx` (958 LOC) + `useIntelMix` are **dead code**
  (`:179-180`).

**Downstream of every mode**, one shared engine: `/api/bolt/execute` → `bolt_execution_runs` →
STAGES `[source-recommendation, ai/plan, commit-plan, generate-weekly-structure,
creator-asset-generation, schedule-structured-plan]` (`boltPipelineServiceRunExecWeekly.ts:321-328`)
→ `daily_content_plans` → two scheduler lanes (text `boltScheduleBlockProcessor`, creator
`creatorRowScheduler`) → `scheduled_posts`.

---

## 2. Current Workflow Diagram

```
                      ┌────────────────────  ENTRY (4 modes)  ───────────────────┐
                      │ BOLT Text │ BOLT Creator │ Intelligent Mix │ "Strategy Mix"│
                      └─────┬──────────┬───────────────┬────────────────┬────────┘
                            │          │               │                │
                   single-form → 3 AI strategy cards → confirm     campaign-planner
                            │  (structure+content FUSED, read-only)     │
                            └──────────────┬───────────┘        Skeleton tab (structure)
                                           ▼                    Strategy tab (content/themes)
                              POST /api/bolt/execute            soft-gate → Build & Launch
                                           │                             │
                              ┌────────────▼─────────────────────────────▼──────┐
                              │  BOLT PIPELINE (fixed order, run-locked)        │
                              │  1 source-recommendation  → campaign row (draft)│
                              │  2 ai/plan  ← campaignAiOrchestrator            │
                              │      • QA gather gate (5 required fields +      │
                              │        explicit confirm) can block generation   │
                              │      • capacity gate → HTTP 422 unless override │
                              │  3 commit-plan → campaign_week_plan (blueprint) │
                              │  4 generate-weekly-structure → daily_content_   │
                              │    plans (delete-then-insert per week)          │
                              │  5 creator-asset-generation (render lane)       │
                              │  6 schedule-structured-plan → scheduled_posts   │
                              └────────────┬────────────────────────────────────┘
                                           ▼
                    POST-GENERATION SURFACES (partial editability)
        campaign-details (weekly board: AI enhance, DnD days, topic workspace)
        campaign-calendar (reschedule time/media only — NOT platform/week)
        campaign chat (refine_day / platform_customize — persist immediately)
        weekly-refinement (manual-edit / finalize-week / populate-daily)
        field-assist (per-field, explicit-only AI — the assist-not-control model)
                                           ▼
              LOCKS: WEEK_EXECUTION_LOCKED (row status='executing' → 423)
                     Blueprint immutable when execution_status='ACTIVE' OR any
                     scheduled_posts row exists; freeze window near publish
```

**Forced orderings that contradict the vision:** (1) structure+content are fused in one AI call in
all BOLT modes; (2) the pipeline runs stages 2→6 as one locked sequence
(`boltPipelineServiceRunExecOrchestrate.ts:400-403`); (3) the QA gather gate blocks `generate_plan`
until 5 required fields + explicit confirmation (`runGatherPhaseGate.ts:89-101`,
`campaignAiOrchestrator.ts:306-316,602-637`); (4) blueprint becomes immutable the moment ANY
scheduled post exists (`campaignBlueprintService.ts:83-92`) — an *early* lock relative to
"scheduling should never lock the campaign prematurely."

---

## 3. Current Architecture Diagram

```
UI SHELLS                         STATE                       PERSISTENCE
─────────                         ─────                       ───────────
BoltCombinedStrategy{Main,        useState in controller;     sessionStorage
 Controller}  (Strategic Mix      no context, no server       'bolt-combined-strategy-state'
 canonical route)                 draft                       (tab-scoped; cleared on launch)

campaign-planner.tsx              PlannerSessionProvider      /api/campaigns/retrieve-plan;
 (Skeleton|Strategy|Build|Design) (usePlannerSession)         campaign_week_plan + versions

campaign-details / WeeklyContent  useCampaignDetailsState     save-wizard-state →
 Section / campaign-calendar      + handlers                  campaign_versions.wizard_state

creator-content workspaces        useCreatorWorkflow{State,   creator_assets (server) +
 (image/carousel/infographic)     Lifecycle,Actions}          localStorage library (cap 50!)

writer-content / blogs/new        per-editor state            blogs / public_blogs

ENGINES
───────
campaignAiOrchestrator (generate_plan | refine_day | platform_customize)
boltPipelineService (6 fixed stages, run lock, heartbeat, sweeper)
generate-weekly-structure (plan → daily rows; platform authority = user selection)
structuredPlanScheduler + executionPlannerService.saveWeekPlans (SOLE write chokepoint,
  delete-then-insert) + creatorRowScheduler / boltScheduleBlockProcessor (two lanes)
orchestration/ (158+ files; SHADOW-only canonical layer — reconciles/diffs, generators
  ignore its decisions; AUTHORITATIVE mode ≈ SHADOW today, generationCutoverManager.ts:11-15,170-173)
```

Coupling to note: the BOLT builders (text/creator/combined) are three near-identical shells over
one pipeline; `campaign-planner` is a fourth shell over the same blueprint stores; the
`orchestration/` layer is a fifth (inert) representation of execution truth.

---

## 4. Database Model

**Structure (three stores, resolved by priority** in `getUnifiedCampaignBlueprint`,
`campaignBlueprintService.ts:194-266`):

| Store | Role | Key facts |
|---|---|---|
| `campaign_week_plan` | PRIMARY blueprint | `weeks jsonb`, `blueprint jsonb`, `status ∈ draft\|committed\|edited_committed` (`campaignPlanStore.ts:187`); monotonic `refinement_version` with optimistic concurrency (`:481-516`); **draft structure with zero content is supported** (`saveDraftBlueprint`, `:215-274`) |
| `campaign_versions` | Snapshot envelope | `campaign_snapshot jsonb` (campaign meta, wizard_state, weekly_plan fallback, build_mode…); append-only, **no monotonic version bump** — "latest" = created_at recency (`campaignVersionStore.ts:3-22,83-99`) |
| `weekly_content_refinements` | Legacy Flow-C | per-week themes/refinements; lowest-priority blueprint source (`campaignBlueprintService.ts:256-264`) |

**Content:** `daily_content_plans` — **`campaign_id NOT NULL`** (every base def, e.g.
`weekly-refinement-daily-plans.sql:54`) → *campaign content cannot exist standalone*. Semantic
payload flattened into `content` TEXT (JSON.stringify) per AUDIT-001 §3. Two lifecycle columns
with **schema drift**: `status` (3+ divergent enum sets across migrations; special value
`'executing'` drives the week lock) and `content_status` (free text, FSM values in
`creatorLifecycleStateMachine.ts:32-40`).

**Standalone content:** `creator_assets` (+`creator_asset_attachments`) — tenant-scoped, nullable
source, **no version history, no edit endpoint** (stable-id upsert only,
`creatorAssetPersistenceService.ts:188-207,387-463`); the real version history
(generate/regenerate/replace/duplicate/restore) lives in **browser localStorage**
(`creator_asset_library`, cap 50, `creatorAssetBackend.ts:21-47`). `blogs` — company-scoped, **no
campaign_id**. `content_assets` — campaign-slot-bound with `current_version`.

**Publish:** `scheduled_posts` — `campaign_id NULLABLE, ON DELETE SET NULL`
(`clean-unified-schema.sql:61`) → posts can be standalone/orphaned. BOLT text adds
`bolt_content_jobs` (master→variants) + `master_content_cache` + `platform_content_slots`.

**Linking is by natural keys, not FKs:** content↔structure via
(`campaign_id, week_number, date, platform, content_type, title`); content↔post via
`scheduled_post_id`. Dedup identity = `(title, platform, content_type, day_of_week)`
(`executionPlannerService.ts:133-166`).

---

## 5. Campaign Lifecycle

**Three unreconciled status axes on `campaigns`:** `status`
(draft/active/paused/completed, no CHECK), `current_stage` (canonical vocab
`planning→week_plan→daily_plan→schedule` in `lib/shared/CampaignStage.ts:7-19`, but writers also
use free text like `'blueprint_committed'`, `boltPipelineServiceRunPlan.ts:709`), and
`execution_status`/`blueprint_status` (UPPERCASE governance axis). Plus a fourth table
`campaign_execution_state` (active/paused/completed).

**Transitions:** commit-plan sets `draft` + `blueprint_committed` (`RunPlan.ts:707-718`);
scheduling completion sets `active` + `schedule` (`RunExecWeekly.ts:309-315`). Stage mirrored into
`campaign_versions.status` (`campaignVersionStore.ts:207-233`).

**Locks (when editing dies):**
- `WEEK_EXECUTION_LOCKED` — any row in the week with `status='executing'` blocks week
  regeneration (`executionPlannerPersistence.ts:66-100`; HTTP 423 at
  `generate-weekly-structure.ts:1931`).
- **Blueprint immutability** — `execution_status='ACTIVE'` **or any `scheduled_posts` row**
  (`campaignBlueprintService.ts:79-92`); freeze window near earliest publish (`:99-121`).
  Unlock requires `INVALIDATED`/`PAUSED`.
- Creator row leases (`claim/extend_creator_execution_lock` RPCs) + `plan_version` optimistic
  concurrency.

**Vs the vision:** "scheduling should never lock prematurely" is violated in spirit: one scheduled
post freezes the whole blueprint; moving an asset to another platform/week has **no API** (the
reschedule endpoint changes time/media only and "does NOT support moving to a different
platform/account", `reschedule.ts:22-23`); the only week-level restructuring path is destructive
delete-then-insert regeneration.

---

## 6. Strengths (already aligned with the vision)

1. **The two-workspace shell exists** — `campaign-planner`'s Skeleton/Strategy/Build tabs with
   soft gating and order independence is the vision's Stage-1/Stage-3 skeleton (`:107-141`).
2. **Structure can persist without content** — draft blueprints
   (`campaignPlanStore.saveDraftBlueprint`) + `campaign_week_plan.status='draft'`.
3. **Standalone content creation exists per type** — creator (image/carousel/infographic + guidance
   types) and all writer/blog types run with no campaign (`creator-content.tsx:158-160`; `blogs`).
4. **A durable asset home exists** — `creator_assets` + `creator_asset_attachments` with a working
   attach lifecycle (writer-attach), reuse picker, tags, and continuity restore.
5. **The assist-not-control AI template exists** — `field-assist` ("AI never runs without an
   explicit request; manual content untouched unless targeted", `field-assist.ts:14-17`), plus
   `refine_day`/`platform_customize` chat modes and weekly-refinement manual edits.
6. **A single content-write chokepoint** — `executionPlannerService.saveWeekPlans`
   ("All planners must use this") gives one place to evolve write semantics.
7. **Post-generation board features exist piecemeal** — weekly board with day drag-and-drop,
   AI-enhance per week, reschedule, calendar; wizard autosave (`save-wizard-state`).
8. **Robust execution substrate** — run locks/heartbeats/sweepers, idempotent stages, per-row
   leases, delete-then-insert integrity, per-platform/day scheduling invariants (AUDIT series +
   `WEEKLY_STRUCTURE_ARCHITECTURE.md`).
9. **QA gate already has legitimate bypasses** — prefilled planning context, existing
   `planningInputs`, `preview_mode` — i.e., the machinery to make AI optional per-surface exists
   (`preparePrefilledPlanningState.ts:35-41,342-395`; `plan.ts:121-131,204-311`).

---

## 7. Weaknesses

1. **Mode identity crisis** — "Strategic Mix" and "Intelligent Mix" are the same page in the
   unified model (`unifiedCreationModel.ts:54-55`), while the hub routes "Strategy Mix" elsewhere
   (`campaigns.tsx:89,109`). Users cannot form a mental model of the fourth mode.
2. **Structure+content fusion** — in BOLT modes, one AI call produces both; the weekly arc is
   read-only; there is no structure-first or content-first path.
3. **Pre-launch persistence is tab-scoped sessionStorage** — no server draft, no
   `campaign_versions` integration until launch (`BoltCombinedStrategyController.tsx:41,364-401`).
4. **Campaign content cannot exist without a campaign** (`daily_content_plans.campaign_id NOT
   NULL`) and library assets cannot be attached into an existing campaign plan (no UI/endpoint —
   agent-verified gap).
5. **Asset "organize/version" pillar is client-only** — localStorage cap 50 holds the canonical
   version history; server table has no versions, no edit, no duplicate; **no library page** (only
   a reuse modal).
6. **Links are frozen at birth** — row `campaign_id` immutable (`updateActivity` strips it,
   `executionPlannerPersistence.ts:231-233`); platform/week moves impossible without destructive
   regeneration.
7. **No approvals, weak review** — validators are advisory (`platformExecutionValidator`,
   `analyzeValidationResults`); `PENDING_APPROVAL` readiness states exist in routing rules but the
   campaign flow never sets them; real approval machinery lives only in creator
   enterprise-governance.
8. **Early hard locks** — blueprint freezes on first scheduled post (§5).
9. **Status-axis sprawl + schema drift** — three campaign status axes, 3+ `daily_content_plans`
   status enums across migrations, divergent `refinement_status` vocabularies.
10. **Parallel representations of truth** — blueprint stores ×3, orchestration/ shadow layer,
    dead `IntelMixView`, deprecated `week_versions` — each a future-maintenance trap.

---

## 8. Gap Analysis (vision pillar → verdict)

| Vision requirement | Verdict | Evidence anchor |
|---|---|---|
| Two independent workspaces, either-first | **PARTIAL** — exists in campaign-planner (soft-gated); absent in the canonical Strategic Mix route | `campaign-planner.tsx:107-141` vs `unifiedCreationModel.ts:55` |
| Structure workspace: manual + AI build/refine, drafts, iterate | **PARTIAL** — skeleton builder + draft blueprints exist; no time-windows/approval-rules/posting-logic controls anywhere; BOLT form owns only ×/wk + start date | agent-1 §3 |
| Content workspace: create/edit/replace/delete/duplicate/version/organize w/o campaign | **PARTIAL** — creation ✅; delete ✅; duplicate/version client-only; edit=regenerate; organize=templates-only; no library UI | agent-3 §1,4,6 |
| Every asset later linkable to structure | **MISSING** — no asset→existing-campaign attach path; `campaign_id NOT NULL` on plan rows | agent-3 §5 gap; agent-2 §3 |
| Editable Structure↔Content relationship | **MOSTLY MISSING** — reschedule=time/media only; no platform/week/link moves | `reschedule.ts:22-23` |
| Per-workspace AI assistants (assist, not control) | **PARTIAL** — field-assist + chat refine modes are the pattern; generate_plan QA gate + fused card generation are the violations | agent-4 §1,4 |
| Stage-3 master board (structure+content+links+timeline+readiness+conflicts+approvals) | **PARTIAL** — details board + calendar + validation summaries; no unified readiness/conflict/approval board; structure not editable there | agent-1 §5 |
| Go back / modify / re-link / replace before publishing | **PARTIAL** — content edits yes; structure edits gated by blueprint locks; re-link no | §5 |
| Scheduling never locks prematurely | **VIOLATED** — first scheduled post freezes blueprint; executing row locks week | `campaignBlueprintService.ts:83-92` |
| Incorrect assumptions | Campaign content presumes generation-time binding (campaign_id NOT NULL); "mode" presumed = generator preset, not workspace; version presumed = snapshot recency |
| Tight coupling | Structure decisions (platform allocation) embedded in AI blueprint; controller monoliths (BoltCombinedStrategyController 700+, WeeklyContentSection 1.4k); dual client/server asset substrates |
| Missing abstractions | CampaignDraft (server), AssetLibrary (server, versioned), Link/Assignment entity (asset↔slot), Approval entity |
| State inconsistencies | sessionStorage vs server; localStorage asset versions vs `creator_assets`; three status axes; snapshot-recency versioning |
| Scaling/maintenance risks | Schema drift; 5 parallel truth representations; localStorage cap 50 data loss; orphaned scheduled_posts |

---

## 9. Required Architecture Changes

*(What must change conceptually; no code.)*

1. **Resolve the identity: make `campaign-planner` the Strategic Mix shell.** Point
   `strategic-mix-campaign` at it; keep BOLT Combined as the Intelligent Mix single-shot
   generator. One mode = one mental model.
2. **Introduce a server-side `CampaignDraft`** unifying pre-launch state (today: sessionStorage +
   wizard_state + draft blueprint) — one durable draft entity both workspaces read/write.
3. **Promote the asset library to a first-class server entity** — either extend `creator_assets`
   (versions, edit metadata, duplicate) or generalize `content_assets` to allow
   campaign-unbound rows; retire localStorage as the source of truth (keep as cache).
4. **Introduce a Link/Assignment primitive** — an explicit, editable relation
   (asset ↔ campaign slot: week/day/platform) instead of generation-time row embedding. The
   natural seam is `saveWeekPlans`' write chokepoint + the existing `creator_asset_attachments`
   pattern (add a `campaign` adapter — the enum already anticipates `'campaign-creator'`,
   `creatorAttachmentSession.ts:35-41`).
5. **Split "plan generation" from "structure commitment"** — the pipeline's stages 2-3 vs 4-6 are
   already separable (`runGenerateWeeklyStructure` standalone entry exists,
   `RunExecOrchestrate.ts:791`); Strategic Mix should invoke them independently per workspace.
6. **Adopt field-assist as the AI contract for both workspace assistants**; `generate_plan`'s QA
   gate becomes an *optional* "AI build it for me" path (its prefill bypasses already make this a
   configuration decision, not new machinery).
7. **Soften the lock model** — replace "any scheduled post freezes blueprint" with per-item
   locking (only rows in freeze-window/executing are immutable), aligning with the existing
   week-level and row-level lock granularity.
8. **Do NOT build a fifth engine.** Every gap maps onto existing seams; a parallel Strategic Mix
   pipeline would repeat the weekly_content_refinements/IntelMixView drift pattern.

Components to split/merge/quarantine: split `BoltCombinedStrategyController` state from launch
plumbing if reused; merge the three BOLT builder shells' duplicated chip/stepper/platform-picker
logic; quarantine dead `IntelMixView.tsx`/`useIntelMix` (AUDIT-003 §9 concurs); consolidate the
three blueprint stores' read path (already done via `getUnifiedCampaignBlueprint`) into a single
write vocabulary.

## 10. Required UI Changes

- Strategic Mix entry lands on a **two-workspace home** (Structure | Content), both accessible in
  any order — extend campaign-planner's existing tabs; remove any implicit ordering cues.
- **Structure workspace additions:** time-windows/day-of-week/cadence controls, approval-rule
  toggles, channel participation — none exist today (agent-1 §3); AI panel = "draft structure for
  me" (cards → *editable* skeleton, not read-only preview).
- **Content workspace additions:** a real **library page** (grid of saved assets: filter by
  type/tag/campaign/status; edit/duplicate/version/delete) — the reuse-picker + catalog logic is
  reusable; per-asset "Add to campaign…" action.
- **Alignment view:** a linking surface (asset ↔ week/day/platform) with drag-to-assign; the
  weekly board's existing day-DnD is the interaction precedent.
- **Stage-3 master board:** extend campaign-details with readiness/validation/conflict/approval
  panels (validators already emit summaries; surface them) + structure editing entry points.
- Persistent draft indicator + explicit "Save draft" in place of silent sessionStorage.

## 11. Required Workflow Changes

- Either-first entry (Structure↔Content) with soft gating (pattern exists: `canBuild`).
- AI invocation becomes per-workspace and optional; QA interrogation only inside the "AI build"
  flow, never as a gate on manual work.
- Decouple launch: Structure commit, Content generation, Linking, and Scheduling become four
  user-visible steps (today: one pipeline run).
- Review-before-schedule stage with re-entry (back to either workspace) — requires the softened
  lock model (§9.7).
- Approval hooks (optional per company) at link-time and pre-publish, reusing routing rules'
  `PENDING_APPROVAL` states.

## 12. Required Backend Changes

- Draft API: create/read/update `CampaignDraft` (structure part → existing draft-blueprint path;
  content part → asset refs + unassigned briefs).
- Asset library API: list/search (server-side catalog), edit-metadata, duplicate, version-append,
  restore (port localStorage semantics to `creator_assets`).
- Attach API: `attach asset → campaign slot` (creates/updates the plan row via `saveWeekPlans`
  single-row path or a new non-destructive upsert beside it) + detach/move (change week/day/
  platform of an existing link, respecting per-platform/day invariants).
- Reschedule extension: platform/week moves (today time/media only).
- Standalone planner-stage endpoints: expose stages 2/3/4/6 individually for the workspace flows
  (stage 4 already standalone).
- Approval endpoints (set/clear `approval_status`; wire routing-rule readiness).

## 13. Required Database Changes

- **Either** make `daily_content_plans.campaign_id` nullable (staging rows) **or** — lower blast
  radius — keep plan rows campaign-bound and add a `campaign_asset_links` table
  (asset_id ↔ campaign_id/week/day/platform, status, approved_by), letting plan rows be
  materialized from links.
- Version history for `creator_assets` (versions table or jsonb history), matching client
  semantics.
- Monotonic version on `campaign_versions` (today caller-supplied/recency).
- Status-axis consolidation + CHECKs (one canonical vocabulary per column; migrate drifted
  enums); `approval_status` column where routing rules expect it.
- Draft entity storage (likely `campaign_versions.status='draft'` + snapshot shape formalized).

## 14. Required AI Orchestration Changes

- Mode registry: Strategic Mix invokes `generate_plan` only from the Structure workspace's
  "AI build" action, with `prefilledPlanning` from workspace state (existing bypass machinery —
  no new gate logic).
- Content-workspace assistant = field-assist + a "draft asset from brief" action per type
  (existing per-type generators).
- `refine_day`/`platform_customize` surfaced as board actions (already persist immediately).
- Keep capacity validation as a *linking-time* advisor (not a 422 on generation) for this mode.
- Leave the `orchestration/` shadow layer as-is; it is the eventual canonical substrate but must
  not be a dependency of this work (it is inert by design, `generationCutoverManager.ts:170-173`).

## 15. Required State Management Changes

- Replace BOLT-Combined sessionStorage with the server `CampaignDraft` (autosave, like
  `save-wizard-state`); keep sessionStorage as offline buffer only.
- Point `setCreatorAssetBackend` at a server-backed store; localStorage becomes cache (cap-50 data
  loss disappears).
- One `StrategicMixSessionProvider` extending `PlannerSessionProvider` to hold both workspaces +
  link state; URL-addressable tab/selection so navigation survives reload.
- Reconcile the three campaign status axes behind one read model (a `getCampaignLifecycle()`
  selector) before adding any new states.

## 16. Recommended Implementation Phases

1. **P0 — Identity & routing:** point `strategic-mix-campaign` at campaign-planner; quarantine
   dead IntelMix code; label cleanup. (Days.)
2. **P1 — Durable drafts:** server CampaignDraft for both workspaces; kill sessionStorage
   dependence. (Small.)
3. **P2 — Server asset library:** versions/edit/duplicate on `creator_assets` + library page +
   backend catalog. (Medium.)
4. **P3 — Link primitive + Alignment UI:** `campaign_asset_links` (or nullable staging) + attach/
   detach/move APIs + linking surface; extend reschedule to platform/week. (Largest single piece.)
5. **P4 — Workspace AI assistants:** structure-AI (cards→editable skeleton) + content-AI
   (field-assist + draft-asset), QA gate scoped to opt-in path. (Medium.)
6. **P5 — Master board & approvals:** readiness/conflict/approval panels on campaign-details;
   soften blueprint lock to per-item. (Medium.)
7. **P6 — Hygiene (parallelizable):** status-axis consolidation, schema-drift CHECKs, monotonic
   versions. (Ongoing.)

Order rationale: P0-P2 are independent low-risk wins; P3 is the vision's core and depends on P2;
P4-P5 layer UX on stable primitives; constraint enforcement from AUDIT-002 §12 should ride P6
early (model-agnostic, per AUDIT-003 §11.1).

## 17. Risk Assessment

| Risk | Severity | Mitigation anchor |
|---|---|---|
| Fifth parallel engine / divergence (the historical failure mode: weekly_content_refinements, IntelMixView, orchestration/) | **High** | Build on saveWeekPlans + attachments + planner session; no new pipeline |
| Two-path parity (AI-orchestrator vs synth) breaks when structure is user-authored | High | Route manual structure through the same blueprint commit + generate-weekly-structure path (characterization suite exists) |
| Nullable campaign_id blast radius (every reader assumes NOT NULL) | High | Prefer the links-table alternative (§13) |
| Lock softening vs scheduling integrity (one-per-platform/day, dedup) | Medium | Keep invariants in saveWeekPlans; only narrow the freeze scope |
| localStorage→server migration losing user libraries | Medium | One-time import path; keep client cache |
| Schema drift makes migrations non-replayable locally | Medium | Known issue (memory: migration-collision); verify via prod-shape, code-first |
| Concurrent-agent churn in these exact files (intelligent-mix work in flight; stash `feat/intelligent-mix` observed) | Medium | Land P0/P1 behind the planner surface, not the BOLT builders |
| Credit/billing semantics for workspace AI actions | Low | field-assist billing pattern already exists (`content_rewrite`) |

## 18. Complexity Assessment

- **Low:** P0 routing/labels; P1 drafts (existing endpoints/patterns); dead-code quarantine.
- **Medium:** server asset library (port client semantics); workspace AI wiring (existing modes +
  bypasses); master-board panels (data already computed); approval states (columns + surfacing).
- **High:** link primitive + non-destructive plan mutation (touches the delete-then-insert model,
  scheduling invariants, both lanes, WEEK_EXECUTION_LOCKED semantics) — this is where 60%+ of the
  engineering cost lives; softened blueprint locking (freeze-window redesign).
- **Deliberately out of scope:** orchestration/ cutover; Model-B/C master-idea evolution
  (AUDIT-003) — complementary but orthogonal; do not couple.

## 19. Estimated Implementation Order

`P0 → P1 → P2 → (AUDIT-002 constraint enforcement) → P3 → P4 → P5 → P6-continuous`
P2 and P4 can overlap; P3 must not start before P1 (drafts) since links need a durable home;
P5's lock softening last — it de-risks against live campaigns only after re-entry flows exist.

## 20. Files Involved (primary surface, by area)

**Routing/entry:** `lib/content/unifiedCreationModel.ts` · `pages/command-center/campaigns.tsx` ·
`pages/command-center/{bolt-combined,bolt-text,bolt-creator,intelligent-mix}-strategy.tsx` ·
`pages/command-center/marketing-create.tsx`
**Strategic Mix shell:** `pages/campaign-planner.tsx` (+ `SkeletonBuilderPanel`,
`PlanningCanvas`, `StrategicThemeCards`, `WeekDailyPlanPanel`, `PlannerSessionProvider`) ·
`pages/campaign-planning.tsx`
**BOLT builder (today's canonical route):** `components/command-center/BoltCombinedStrategy{Main,Controller}.tsx` ·
`hooks/useBoltStrategy.tsx` · `hooks/useBoltCreator.tsx` · dead: `components/IntelMixView.tsx`,
`hooks/useIntelMix.tsx`
**Boards:** `pages/campaign-details/[id].tsx` + `WeeklyContentSection.tsx` +
`useCampaignDetails{State,Handlers}` · `pages/campaign-calendar/[id].tsx` + `useCampaignCalendar.tsx`
**AI orchestration:** `backend/services/campaignAiOrchestrator.ts` + `campaignAiOrchestrator/*`
(esp. `runGatherPhaseGate`, `preparePrefilledPlanningState`, `publicTypes`) ·
`pages/api/campaigns/ai/{plan,plan-v2}.ts` · `backend/constants/campaignPlanningGatherOrder.ts` ·
`pages/api/creator-templates/field-assist.ts`
**Pipeline/scheduling:** `backend/services/boltPipelineService*.ts` ·
`pages/api/bolt/{execute,progress,strategy-cards}.ts` ·
`pages/api/campaigns/generate-weekly-structure.ts` (+ `WEEKLY_STRUCTURE_ARCHITECTURE.md`) ·
`backend/services/executionPlanner{Service,Persistence}.ts` ·
`backend/services/structuredPlanScheduler*.ts` · `backend/services/creator/creatorRowScheduler.ts` ·
`backend/services/boltScheduleBlockProcessor.ts` · `pages/api/activity-workspace/[id]/reschedule.ts`
**Structure stores:** `backend/services/campaignBlueprintService.ts` ·
`backend/db/campaignPlanStore.ts` · `backend/db/campaignVersionStore.ts` ·
`backend/types/CampaignBlueprint.ts` · `pages/api/campaigns/{weekly-refinement,commit-plan,apply-weekly-plan-edits,retrieve-plan}.ts`
**Content/assets:** `pages/command-center/creator-content*.{tsx,/}` ·
`components/creator/workflow/*` · `backend/services/creatorAssetPersistenceService.ts` ·
`pages/api/creator-assets/*` · `lib/content/{creatorAssetLibrary,creatorAssetBackend,creatorAssetCatalog,creatorAttachmentSession,creatorAssetUsageGraph,creatorContentBridge,launchCampaignFromContent}.ts` ·
`components/creator/AssetReusePicker.tsx` · `backend/services/blogService.ts` · `pages/blogs/*` ·
`backend/db/contentAssetStore.ts` · `backend/services/creator/{collectionService,campaignDesignSystemService}.ts`
**Canonical shadow layer (observe only):** `backend/services/orchestration/*`
(`generationCutoverManager`, `canonicalExecutionAdapter`, `executionRoutingRules`)

---

*CAMPAIGN-AUDIT-004 · read-only audit · evidence from four parallel code sweeps + AUDIT-001/002/003
+ the weekly-structure/orchestrator characterization work. No files modified; no code proposed.*
