# generate-weekly-structure — Architecture & Change-Safety Contract

_Audited 2026-07-09. Covers `pages/api/campaigns/generate-weekly-structure.ts` (1,925 LOC)
and its helper modules `weeklyStructureHelpersAlloc.ts` / `weeklyStructureHelpersShape.ts`
(re-exported through the 6-line barrel `pages/api/campaigns/weekly-structure-helpers.ts`)._

## Module map

| Unit | Class |
|---|---|
| `handler` (default export) | Adapter — POST-only; maps `WEEK_EXECUTION_LOCKED` → 423, everything else → 500 |
| `generateWeeklyStructure` | **Orchestrator** — one ~1,760-line function, BOLT-critical |
| `isValidCreatorPlatformAssetCombo` | Pure — byte-for-byte TS mirror of DB CHECK `is_valid_creator_platform_asset_combo`; must track the migration, never "simplify" |
| helpers (Alloc/Shape) | Pure derivation core (deriveSubTopic, computeDayDate, buildCreatorCard, …) + the three mutation-guard asserts |

## Execution pipeline (order is behavior — do not reorder)

```
input normalization (conflict_policy default 'avoid'; postsPerWeek clamp 2..20;
cross_platform_sharing default true) → require campaignId+weeks → campaign fetch
→ start_date backfill WRITE when missing but supplied → require start_date
→ blueprint fetch + per-week existence check → compressed context (cache read →
build from insights/strategy-memory/profile/exec-config → cache write; all
best-effort) → plan version read → cross-campaign occupied-day map (best-effort)
→ PER-WEEK LOOP:
    distribution resolution (blueprint distribution_strategy > distribution_mode
    input > sharing flag) → execution_items normalization (AI) OR synthesis from
    blueprint (buildTopicSlots closure) → format_frequency reconciliation
    (pad/trim/drop; user formats are THE authority on counts) → BOLT
    frequency-is-total split (round-robin single-platform pieces) → topic dedupe
    guard (deriveSubTopic rewrite) → deterministic daily-item build with
    DETERMINISTIC_TOPIC_INTENT_REQUIRED guards + 3 mutation asserts per stage
    → DELETE daily_content_plans for (campaign, week)   ← destructive boundary
    → per-item × per-platform row loop:
        duplicate-content drop → platform best-day pick (per-platform cursor)
        → one-per-platform-per-day shift (conflict_policy: avoid shifts, skip
        drops, override ignores siblings) → identity/progression/intent asserts
        (writer-ready) → validate → optional auto-rebalance retype → enrich →
        creator lane (routeRequiresMediaIntent → asset_type derivation →
        post_with_asset fallback → text lane) → feature-flagged Step-7 planning
        / Step-4 adapter (both OFF ⇒ legacy inline packaging/asset_payload
        stubs) → row assembly (content = JSON.stringify(enriched))
    → execution feedback + publishing optimization → optional
    auto_optimize_distribution reassignment pass (re-validate/re-enrich, creator
    stub carry-forward) → optional campaign waves (wave_info only; date NOT
    mutated) → weekly_content_refinements JSON persistence (best-effort)
→ POST-LOOP: resolveWeeklyRowsForPersistence (SHADOW default) → row-level
  validateDailyPlanRow with SKIP-AND-RECORD diagnostics (CTA failures are
  warning-class and still persist) → all-rows-rejected ⇒ DAILY_PLAN_ROW_INVALID
  throw → saveWeekPlans per week ('blueprint' source) → fire-and-forget
  orchestration reconcile/gates (void …catch)
```

## Mutable state (all function-local to the orchestrator)

Loop-carried: `allFinalItems`, `allRowsToInsert`, `last*` result carriers (the
RESULT reflects the LAST week only — multi-week envelope semantics),
`existingScheduledByPlatform`. Per-week: `synthGlobalIdx`/`globalTopicIdx`
(mutated by the `buildTopicSlots` closure — shared by synth AND reconciliation
paths; extraction would break the shared counters), `platformDayCursor`,
`usedDatesByPlatform`, `usedContentByPlatform`, `executionItems` (reassigned by
reconcile + frequency split), `rowsWithContent` (rebuilt in-place by
auto-optimize).

## Behavioral contracts (never change silently)

- **Scheduling integrity** (memory: BOLT rules): ≤1 piece per platform per day;
  no duplicate (content_type, topic) per platform; format_frequency is the TOTAL
  across platforms; tweet is X-exclusive, poll blocked on X
  (`filterPlatformsForFormat` is the single authority).
- **Precedence** (owner policy 2026-07-10): the USER's explicit
  `eligible_platforms` selection is the platform authority — synth platforms
  use it directly, and AI execution_items' platforms are intersected with it
  (disjoint ⇒ the piece is REASSIGNED to the user's platforms, never dropped
  and never left on an unselected platform). Blueprint `platform_allocation`
  keys drive platforms ONLY when the user made no selection. User
  `format_frequency` beats AI counts; card-stamped template beats
  design-system pool pick. (Pre-2026-07-10 behavior was allocation-first —
  users who picked linkedin+facebook could receive instagram.)
- **Mutation guards**: `assertDaily{Intent,ExecutionIdentity,GlobalProgression}NotMutated`
  run at daily-build / writer-ready / post-validate / post-enrich; validators
  and enrichers must return identity on those fields or generation throws.
- **Destructive ordering**: week's `daily_content_plans` are DELETED before rows
  are rebuilt; delete must stay before saveWeekPlans and inside the week loop.
- `content_type` on the row is the USER format (poll, short_story…), never the
  validator's mapped type. Creator rows must carry the packaging/asset_payload/
  asset_instruction stubs or the DB `creator_payload_check` rolls back the batch.
- Feature flags OFF (`applyCreatorPlanningFlow` / `applyCreatorBlueprint`) must
  leave the legacy inline path byte-identical.
- Error taxonomy: BoltError codes (WEEK_STRUCTURE_VALIDATION_FAILED,
  BLUEPRINT_NOT_FOUND, WEEK_NOT_FOUND, PLAN_STRUCTURE_INVALID with
  DETERMINISTIC_* messages, DAILY_PLAN_ROW_INVALID) and the 423 lock mapping.

## IO boundaries

DB (supabase): campaigns (read + start_date backfill write), campaign_versions,
daily_content_plans (sibling read, week delete), weekly_content_refinements
(history read, feedback write). Services: blueprint, validator/enricher, platform
rules, posting times, feedback/optimization/waves, context cache (get/set),
strategy memory/profile cache, design-system pool, saveWeekPlans (dynamic),
orchestration reconcile/gates (dynamic, fire-and-forget), row-failure
diagnostics. **No AI calls in this flow** (`refineDailyObjectivesWithLLM` is
imported but never invoked).

## Characterization

`backend/tests/unit/generateWeeklyStructureCharacterization.test.ts` — 16 tests +
2 golden-master snapshots (persisted rows + result envelope). Locks: input
validation & error taxonomy, start_date backfill write, synth path end-to-end
(frequency-total split, scheduling integrity invariants, creator lane
image/post_with_asset/text resolution, plan_version stamping), format-drop when
no eligible platform, AI-path format_frequency pad/trim/drop + pass-through,
conflict policies skip/override, handler 405/423/500. DB is a scripted chainable
mock; validator/enricher are identity (the REAL mutation asserts verify the
wiring); helpers and lib/shared/bolt stay real.

**Uncovered paths** (extend before touching): multi-week `weeks[]` runs,
STAGGERED distribution strategy, auto_rebalance retype branch,
auto_optimize_distribution reassignment pass, campaign waves,
all-rows-rejected throw, diagnostics recording with a BOLT runId,
authoritative (non-SHADOW) persistence resolution.

## Governance verdict (2026-07-09)

Architecture 55/100 · Testability 70/100 (was ~15) · Maintainability 58/100.
Coupling: efferent very high (~25 modules) but through clean seams; afferent =
boltPipelineService + HTTP. Cohesion: high (one pipeline). Runtime risk of
decomposition: VERY HIGH — closure-shared counters, delete-before-insert
ordering, DB CHECK mirrors, flag-gated byte-parity paths. **Verdict B: optimal
maintainable form under the behavior-preservation constraint.** The only safe
future evolution is the one already in progress in the code itself: the
feature-flagged Step-4/Step-7 creator cutover and Phase-2 authoritative
generator, which migrate behavior behind flags with shadow diffs — not a
mechanical split. Extend the characterization suite before enabling those flags.
