# AI Planning Contract Lock Report

**Module:** Campaign Planner Stabilization  
**Focus:** AI Planning Contract Lock  
**Product:** Omnivyra  
**Date:** 2026-03-08

---

## SECTION 1 — REMOVE RECORD FALLBACK TYPES

**File:** `backend/types/campaignPlanning.ts`

**Status:** Done

**Changes:**
- `idea_spine` uses `IdeaSpine | null` only
- `strategy_context` uses `StrategyContext | null` only
- Removed `IdeaSpine | Record` and `StrategyContext | Record`

---

## SECTION 2 — REMOVE MESSAGE OVERRIDE PATH

**File:** `backend/services/aiPlanningService.ts`

**Status:** Done

**Fix applied:**
- Removed `AiPlanningInput` interface and `messages` parameter
- `generateCampaignPlanAI` accepts only `PlanningGenerationInput`
- AI planning relies solely on `PlanningGenerationInput`; no pre-built message override

---

## SECTION 3 — CREATE PROMPT BUILDER

**File:** `backend/services/campaignPromptBuilder.ts` (created)

**Purpose:**
- `buildCampaignPlanningPrompt(input: PlanningGenerationInput)`
- Constructs AI planning prompt (preview or orchestrator path)
- Returns structured prompt messages (`PromptMessage[]`)

---

## SECTION 4 — UPDATE AI SERVICE

**File:** `backend/services/aiPlanningService.ts`

**Flow:**
1. `buildCampaignPlanningPrompt(input)` → constructs prompt messages
2. `generateCampaignPlan` (AI model) → executes with messages
3. AI service does not construct prompts directly

---

## SECTION 5 — UPDATE ORCHESTRATOR

**File:** `backend/services/campaignAiOrchestrator.ts`

**Changes:**
- Orchestrator passes only `PlanningGenerationInput` (with `orchestratorPromptContext` when applicable)
- Removed `messages` parameter
- Removed prompt override path
- Repair/regeneration flows use `orchestratorPromptContext.repairAppend` instead of pre-built messages
- Extracted `buildPromptContext` → `campaignOrchestratorPromptBuilder.buildOrchestratorPrompt`

---

## SECTION 6 — VALIDATION TEST

**Preview pipeline:**
- `planPreviewService.generatePlanPreview(input)` → `generateCampaignPlanAI(input)` → `buildCampaignPlanningPrompt(input)` → `parseAndValidateCampaignPlan`

**Persisted pipeline:**
- `campaignAiOrchestrator.runWithContext()` → `generateCampaignPlanAI({ orchestratorPromptContext })` → `buildCampaignPlanningPrompt(input)` → `parseAndValidateCampaignPlan`

Both pipelines use:
- `buildCampaignPlanningPrompt`
- `generateCampaignPlanAI`
- `parseAndValidateCampaignPlan`

---

## SECTION 7 — REPORT

### FILES_CREATED

| File | Purpose |
|------|---------|
| `backend/services/campaignPromptBuilder.ts` | Single entry point for prompt construction; branches preview vs orchestrator |
| `backend/services/campaignOrchestratorPromptBuilder.ts` | Builds orchestrator planning prompts (extracted from orchestrator) |

### FILES_MODIFIED

| File | Fix applied |
|------|-------------|
| `backend/types/campaignPlanning.ts` | Added `OrchestratorPromptContext`, extended `PlanningGenerationInput` with `orchestratorPromptContext`, `campaignId`, `bolt_run_id`; no Record fallbacks |
| `backend/services/aiPlanningService.ts` | Removed messages override; always uses `buildCampaignPlanningPrompt` |
| `backend/services/campaignAiOrchestrator.ts` | Passes `orchestratorPromptContext` instead of messages; removed `buildPromptContext`; repair/regeneration use `repairAppend` |

### AI_PIPELINE_TEST

| Check | Result |
|-------|--------|
| prompt_builder_call | `buildCampaignPlanningPrompt` used by `aiPlanningService` |
| ai_service_call | `generateCampaignPlanAI` accepts `PlanningGenerationInput` only; no messages param |

### TYPE_CONTRACT_TEST

| Type | Status |
|------|--------|
| `PlanningGenerationInput` | Strict: `IdeaSpine \| null`, `StrategyContext \| null` |
| `OrchestratorPromptContext` | Defined for orchestrator flow |
| `repairAppend` | Added for repair/regeneration flows |

### COMPILATION_STATUS

| Status | Errors | Warnings |
|--------|--------|----------|
| Pass | 0 | 0 |

---

## CONSTRAINTS ADHERED

- Schema not modified
- BOLT pipeline not modified
- Only AI planning contract locked
