# campaignAiOrchestrator — Architecture & Change-Safety Contract

_Audited 2026-07-09/10. Covers `backend/services/campaignAiOrchestrator.ts`
(1,234 LOC) + the 30 submodules under `campaignAiOrchestrator/`._

## Classification

The main file is no longer a monolith in the usual sense: ~30 submodules were
already extracted (context prep, plan recovery, deterministic weeks, salvage,
heartbeat, transforms, topic assignment, executor). What remains in-file is
`runWithContext` (~1,090 lines): **Coordinator / state machine** — the
planner's gate sequence and mode dispatch. `runCampaignAiPlan` is a thin
delegate to `executeRunCampaignAiPlan(input, runWithContext)`.

## Gate sequence (order is behavior — do not reorder)

```
executor: campaign+version fetch → gather-phase gate (non-null result
short-circuits) → fast-path detection (conversational plan confirmation) →
execution context → prefilled planning state → runtime planning context
(supplies the EFFECTIVE qaState — it overrides the execution-context value in
the ctx spread) → runWithContext:
  emit 'context' substage → preparePlanningRunContext (builds planningInput)
  → capacity-validation failure gate → QA short-circuit (not readyToGenerate
    ⇒ return next question, NO LLM CALL — the cost contract)
  → admission control (generate_plan ONLY; rejection returns the retry-after
    conversational response with admission_* stamped into omnivyre_decision.raw)
  → cluster overload policy (cached 2s) → cost guidance (advisory)
  → PlannerBudget (global wall-clock ceiling)
  → local overload detection (LLM pool pressure + BullMQ queue pressure)
  → DRAFTING: generateCampaignPlanAI under AbortController budget
    (DRAFTING_BUDGET_MS, clamped to global budget) + 15s heartbeat + streaming
    salvage buffer (partial output survives aborts; PROVIDER_PARTIAL_STREAM
    duck-typed) → failure/timeout ⇒ placeholder fallback from plan skeleton
    (partial-salvage first) — the user ALWAYS gets a campaign object
  → MODE DISPATCH:
      refine_day        → parseAiRefinedDay → saveStructuredCampaignPlanDayUpdate
      platform_customize→ parseAiPlatformCustomization → savePlatformCustomizedContent
      generate_plan     → parseStructuredPlanWithRecovery → validation →
                          post-process → alignment recovery → deterministic
                          weeks → finalize → async refinement enqueue
→ executor tail: evaluateGeneratedPlan (validation + paid recommendation)
```

## Never change silently

- **QA and admission gates run BEFORE any LLM call** (cost + overload
  contracts). Admission applies to generate_plan only — refine_day /
  platform_customize bypass it by design.
- Drafting budget abort semantics (placeholder fallback, never a broken UI),
  streaming salvage precedence, heartbeat cadence.
- ctx spread order in the executor (runtime-planning qaState wins).
- The retry-after conversational message and `admission_*` raw stamps —
  consumed by the UI.

## Characterization

`backend/tests/unit/campaignAiOrchestratorCharacterization.test.ts` — 5 tests +
1 snapshot: refine_day full flow (draft → parse → persist → envelope),
platform_customize flow, admission-rejection short-circuit (no draft call),
QA short-circuit (no draft call, next question surfaced), and the
generate_plan-only scoping of admission. Context-prep submodules are scripted;
runWithContext gating order, PlannerBudget, and the fallback result builders
run REAL. Pre-existing suites cover budget/heartbeat/salvage/alerting
(plannerHardening), transforms (voiceAdoption), topic assignment
(topicDifferentiation), async refinement (plannerDistributedHardening).

**Uncovered paths** (extend before touching): generate_plan happy path
(structured-plan parse → validation → deterministic weeks), drafting
timeout/placeholder fallback, partial-stream salvage, overload degradation
behavior, capacity-validation failure gate, gather-phase gate results.

## Governance verdict (2026-07-10)

Architecture 72/100 (already inverted into submodules; the remaining body is
the gate sequence itself) · Testability 62/100 (was ~30 — subsystems tested,
core untested) · Maintainability 65/100. Coupling: high efferent, all seam-
mocked. Cohesion: high. Runtime risk of decomposition: HIGH — the gate ORDER
is the product (cost/overload contracts). **Verdict B: optimal maintainable
form under the behavior-preservation constraint.** Further extraction would
only relocate the sequence; extend the characterization suite toward the
generate_plan happy path instead.
