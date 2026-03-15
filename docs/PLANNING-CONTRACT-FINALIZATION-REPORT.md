# Planning Contract Finalization Report

**Module:** Campaign Planner Stabilization  
**Focus:** Planning Contract Finalization  
**Product:** Omnivyra  
**Date:** 2026-03-08

---

## SECTION 1 — RESTORE STRICT PLANNING INPUT

**File:** `backend/types/campaignPlanning.ts`

**Status:** Done

**Changes:**
- `PlanningGenerationInput` contains only: `companyId`, `idea_spine` (IdeaSpine), `strategy_context` (StrategyContext), `campaign_direction`
- Removed: `orchestratorPromptContext`, `campaignId`, `bolt_run_id` from `PlanningGenerationInput`
- `campaignId` and `bolt_run_id` moved to optional `GenerateCampaignPlanAIOptions` parameter on `generateCampaignPlanAI`

---

## SECTION 2 — REMOVE NULLABLE INPUTS

**Status:** Done

- `idea_spine`: `IdeaSpine` (required, not null)
- `strategy_context`: `StrategyContext` (required, not null)
- `campaign_direction`: `string` (required)

---

## SECTION 3 — MERGE PROMPT BUILDERS

**Status:** Done

- Deleted: `backend/services/campaignOrchestratorPromptBuilder.ts`
- All prompt construction in: `backend/services/campaignPromptBuilder.ts`
- Extended path logic inlined as `buildExtendedPromptFromPayload` when `idea_spine.promptPayload` is present
- Preview path: `buildPreviewMessages` when no `promptPayload`

---

## SECTION 4 — REMOVE ORCHESTRATOR PROMPT CONTEXT

**File:** `backend/services/campaignAiOrchestrator.ts`

**Status:** Done

**Changes:**
- Removed `orchestratorPromptContext` as separate parameter
- Orchestrator builds `PlanningGenerationInput` with `idea_spine.promptPayload` holding extended context
- Repair flows modify `idea_spine.promptPayload` directly (add `repairAppend` to payload)
- No top-level `orchestratorPromptContext` or `repairAppend` on input

---

## SECTION 5 — SIMPLIFY PROMPT BUILDER

**File:** `backend/services/campaignPromptBuilder.ts`

**Status:** Done

- Prompt builder accepts only `PlanningGenerationInput`
- Branching is data-driven (presence of `idea_spine.promptPayload`), not caller-type driven
- Single entry point: `buildCampaignPlanningPrompt(input: PlanningGenerationInput)`

---

## SECTION 6 — VALIDATION TEST

**Preview pipeline:**  
`generatePlanPreview(input)` → `generateCampaignPlanAI(input)` → `buildCampaignPlanningPrompt(input)` → `parseAndValidateCampaignPlan({ companyId, rawOutput })`

**Persisted pipeline:**  
`campaignAiOrchestrator.runWithContext()` → `generateCampaignPlanAI(planningInput, options)` → `buildCampaignPlanningPrompt(planningInput)` → `parseAndValidateCampaignPlan({ companyId, rawOutput })`

Both pipelines use identical `PlanningGenerationInput` structure: `companyId`, `idea_spine`, `strategy_context`, `campaign_direction`.

---

## SECTION 7 — REPORT

### FILES_REMOVED

| File | Purpose |
|------|---------|
| `backend/services/campaignOrchestratorPromptBuilder.ts` | Orchestrator prompt logic merged into campaignPromptBuilder |

### FILES_MODIFIED

| File | Fix applied |
|------|-------------|
| `backend/types/campaignPlanning.ts` | Strict `PlanningGenerationInput`: only companyId, idea_spine, strategy_context, campaign_direction; non-nullable idea_spine and strategy_context; removed OrchestratorPromptContext, campaignId, bolt_run_id |
| `backend/services/aiPlanningService.ts` | Added `GenerateCampaignPlanAIOptions` for campaignId, bolt_run_id; removed from input contract |
| `backend/services/campaignPromptBuilder.ts` | Merged orchestrator logic as `buildExtendedPromptFromPayload`; single `buildCampaignPlanningPrompt(input)` |
| `backend/services/campaignAiOrchestrator.ts` | Builds `PlanningGenerationInput` with `idea_spine.promptPayload`; repair flows modify `idea_spine.promptPayload` directly; passes options for campaignId/bolt_run_id |
| `backend/services/planPreviewService.ts` | No changes needed; already validates and passes `PlanningGenerationInput` |

### PIPELINE_VALIDATION_TEST

| Check | Result |
|-------|--------|
| preview_pipeline | generatePlanPreview → generateCampaignPlanAI(input) → buildCampaignPlanningPrompt → parseAndValidateCampaignPlan |
| persisted_pipeline | Orchestrator → generateCampaignPlanAI(planningInput, options) → buildCampaignPlanningPrompt → parseAndValidateCampaignPlan |

### TYPE_CONTRACT_TEST

| Type | Status |
|------|--------|
| PlanningGenerationInput | Strict: companyId, idea_spine (IdeaSpine), strategy_context (StrategyContext), campaign_direction (string); all required |

### COMPILATION_STATUS

| Status | Errors | Warnings |
|--------|--------|----------|
| Pass | 0 | 0 |

---

## CONSTRAINTS ADHERED

- Schema not modified
- BOLT pipeline not modified
- Planning contract architecture only
