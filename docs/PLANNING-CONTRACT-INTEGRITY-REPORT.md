# Planning Contract Integrity Report

**Module:** Campaign Planner Stabilization  
**Focus:** Planning Contract Integrity  
**Product:** Omnivyra  
**Date:** 2026-03-08

---

## SECTION 1 — REMOVE PROMPT PAYLOAD INJECTION

**File:** `backend/services/campaignAiOrchestrator.ts`

**Status:** Done

- Removed usage of `idea_spine.promptPayload`
- Orchestrator builds `PlanningGenerationInput` with `idea_spine.refined_title`, `refined_description`, `selected_angle` only
- Repair flows update only `idea_spine.refined_description` (append repair instruction)

---

## SECTION 2 — REMOVE EXTENDED PROMPT BUILDER

**File:** `backend/services/campaignPromptBuilder.ts`

**Status:** Done

- Deleted `buildExtendedPromptFromPayload`
- Prompt construction occurs only through `buildCampaignPlanningPrompt` → `buildPreviewMessages` (via `buildContextBlock`)

---

## SECTION 3 — REMOVE OPTIONS METADATA FROM AI SERVICE

**File:** `backend/services/aiPlanningService.ts`

**Status:** Done

- Removed `GenerateCampaignPlanAIOptions`
- AI service accepts only `PlanningGenerationInput`
- `campaignId` and `bolt_run_id` no longer passed to `generateCampaignPlan` (metadata kept locally in orchestrator)

---

## SECTION 4 — MOVE ORCHESTRATOR METADATA

**File:** `backend/services/campaignAiOrchestrator.ts`

**Status:** Done

- `campaignId` and `bolt_run_id` kept locally in orchestrator (used for persistence, audit, etc.)
- Not passed into planning services

---

## SECTION 5 — ADD INPUT IMMUTABILITY GUARD

**File:** `backend/services/campaignPromptBuilder.ts`

**Status:** Done

- Added `Object.freeze(input)`, `Object.freeze(input.idea_spine)`, `Object.freeze(input.strategy_context)` at start of `buildCampaignPlanningPrompt`
- Prevents runtime mutation of input during prompt construction

---

## SECTION 6 — VALIDATION TEST

**Status:** Done

- Orchestrator repair flows (parse failure, validation failure, alignment regeneration) operate without `promptPayload` injection
- Repair flows update `idea_spine.refined_description` with repair instruction string

---

## SECTION 7 — REPORT

### FILES_MODIFIED

| File | Fix applied |
|------|-------------|
| `backend/types/campaignPlanning.ts` | Removed `promptPayload` from `IdeaSpine` |
| `backend/services/aiPlanningService.ts` | Removed `GenerateCampaignPlanAIOptions`; accepts only `PlanningGenerationInput`; passes `campaignId: null` to gateway |
| `backend/services/campaignPromptBuilder.ts` | Deleted `buildExtendedPromptFromPayload`; single path via `buildPreviewMessages`; added `Object.freeze(input)` |
| `backend/services/campaignAiOrchestrator.ts` | Removed `promptPayload`; builds `idea_spine` with `refined_title`, `refined_description`, `selected_angle`; repair flows update `refined_description`; removed options from `generateCampaignPlanAI` calls |

### PROMPT_PATH_TEST

| Check | Result |
|-------|--------|
| prompt_builder_calls | `buildCampaignPlanningPrompt` only; no alternate paths; single call to `buildPreviewMessages` |

### INPUT_IMMUTABILITY_TEST

| Check | Result |
|-------|--------|
| mutation_attempt | `Object.freeze(input)` applied at start of `buildCampaignPlanningPrompt` |
| result | Input and nested `idea_spine`, `strategy_context` frozen before prompt construction |

### COMPILATION_STATUS

| Status | Errors | Warnings |
|--------|--------|----------|
| Pass | 0 | 0 |

---

## CONSTRAINTS ADHERED

- Schema not modified
- BOLT pipeline not modified
- Planning contract integrity preserved only
