# AI Planning Layer Separation Report

**Module:** Campaign Planner Stabilization  
**Focus:** AI Planning Layer Separation  
**Product:** Omnivyra  
**Date:** 2026-03-08  

---

## Objective

Separate AI prompt generation, AI execution, and planning validation layers to prevent duplication and maintain a single AI planning entry point.

---

## FILES_CREATED

| File | Purpose |
|------|---------|
| `backend/services/aiPlanningService.ts` | Single AI planning entry point. `generateCampaignPlanAI()` builds prompt from PlanningGenerationInput (or uses provided messages), calls AI model, returns rawOutput. |

---

## FILES_MODIFIED

| File | Fix Applied |
|------|-------------|
| `backend/types/campaignPlanning.ts` | Added `IdeaSpine` (refined_title, refined_description, selected_angle) and `StrategyContext` (duration_weeks, platforms, posting_frequency). PlanningGenerationInput references these types. |
| `backend/services/campaignPlanCore.ts` | Removed AI execution logic. Responsibilities limited to `parseAndValidateCampaignPlan` only. Removed `generateCampaignPlanFromInput`. |
| `backend/services/planPreviewService.ts` | Flow: `generateCampaignPlanAI` then `parseAndValidateCampaignPlan`. Removed direct calls to campaignPlanCore generation. |
| `backend/services/campaignAiOrchestrator.ts` | Replaced direct `generateCampaignPlan` (AI) with `generateCampaignPlanAI`. Passes rawOutput into `parseAndValidateCampaignPlan`. All plan generation calls (main, repair, regeneration) use generateCampaignPlanAI. |

---

## AI_ENTRYPOINT_TEST

| Field | Value |
|-------|-------|
| preview_call | generateCampaignPlanAI(input) → parseAndValidateCampaignPlan({ companyId, rawOutput }) |
| persisted_call | generateCampaignPlanAI({ messages, campaignId, ... }) → parseAndValidateCampaignPlan({ companyId, rawOutput }) |

---

## TYPE_VALIDATION_TEST

| Field | Value |
|-------|-------|
| type | IdeaSpine: refined_title, refined_description, selected_angle |
| type | StrategyContext: duration_weeks, platforms, posting_frequency |
| status | PlanningGenerationInput references IdeaSpine \| Record and StrategyContext \| Record |

---

## COMPILATION_STATUS

| Field | Value |
|-------|-------|
| status | PASS |
| errors | (none) |
| warnings | (none) |

---

## CONSTRAINTS OBSERVED

- Schema not modified.
- BOLT pipeline not modified.
- Focus only on separating AI planning layer from planning core.
