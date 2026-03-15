# Planning Core Responsibility Separation Report

**Module:** Campaign Planner Stabilization  
**Focus:** Planning Core Responsibility Separation  
**Product:** Omnivyra  
**Date:** 2026-03-08  

---

## Objective

Restore a clean architecture by separating planning generation, parsing, and validation responsibilities. The planning core must have a single responsibility and a stable contract.

---

## FILES_CREATED

| File | Purpose |
|------|---------|
| (none) | All changes are modifications to existing files. |

---

## FILES_MODIFIED

| File | Fix Applied |
|------|-------------|
| `backend/types/campaignPlanning.ts` | Replaced PlanningInput with `PlanningGenerationInput` (companyId, idea_spine, strategy_context, campaign_direction) and `PlanningParseInput` (companyId, rawOutput). Removed optional fields. |
| `backend/services/campaignPlanCore.ts` | Split into two functions: `generateCampaignPlanFromInput(input)` — call AI, produce raw output; `parseAndValidateCampaignPlan(input)` — parse and validate weekly structure. Deleted `generateCampaignPlanCore`. |
| `backend/services/planPreviewService.ts` | Uses `generateCampaignPlanFromInput` then `parseAndValidateCampaignPlan`. Removed `generateCampaignPlanCore`. Uses `PlanningGenerationInput`. |
| `backend/services/campaignAiOrchestrator.ts` | Orchestrator calls AI planning (generateCampaignPlan), passes rawOutput into `parseAndValidateCampaignPlan`. Removed PlanningInput and `generateCampaignPlanCore`. |

---

## CORE_FUNCTION_TEST

| Field | Value |
|-------|-------|
| generation_function | `generateCampaignPlanFromInput(input: PlanningGenerationInput)` → { rawOutput } |
| parse_function | `parseAndValidateCampaignPlan(input: PlanningParseInput)` → ParsedPlan |

---

## PIPELINE_COMPARISON_TEST

| Field | Value |
|-------|-------|
| preview_weeks | generateCampaignPlanFromInput → parseAndValidateCampaignPlan → plan.weeks |
| persisted_weeks | generateCampaignPlan (orchestrator) → parseAndValidateCampaignPlan → plan.weeks |
| result | Both pipelines use the same `parseAndValidateCampaignPlan`; identical rawOutput produces identical weekly plans. |

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
- Focus only on restoring clear planning core responsibilities.
