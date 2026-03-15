# Planning Pipeline Unification Report

**Module:** Campaign Planner Stabilization  
**Focus:** Planning Pipeline Unification  
**Product:** Omnivyra  
**Date:** 2026-03-08  

---

## Objective

Eliminate planning pipeline divergence and enforce a single canonical planning input structure across preview and persisted campaign generation.

---

## FILES_CREATED

| File | Purpose |
|------|---------|
| (none) | All changes are modifications to existing files. |

---

## FILES_MODIFIED

| File | Fix Applied |
|------|-------------|
| `backend/types/campaignPlanning.ts` | Replaced PreviewPlanningInput with canonical `PlanningInput`: companyId, idea_spine, strategy_context, campaign_direction. Added optional messages, campaignId, bolt_run_id, rawOutput for orchestrator path. |
| `backend/services/campaignPlanCore.ts` | Signature `generateCampaignPlanCore(input: PlanningInput)`. When rawOutput provided: parse+validate only. When messages provided: use for AI. Otherwise: build from idea_spine/strategy_context/campaign_direction. Removed GeneratePlanCoreParams. |
| `backend/services/planPreviewService.ts` | Uses PlanningInput directly. Removed PreviewPlanningInput. Added PlanningValidationError (400) and PlanningGenerationError (500). Calls generateCampaignPlanCore(input). |
| `backend/services/campaignAiOrchestrator.ts` | Replaced inline parseAiPlanToWeeks/validateWeeklyPlan with generateCampaignPlanCore({ rawOutput, companyId, campaignId, ... }). Added companyId to ctx. Removed parseAiPlanToWeeks and validateWeeklyPlan imports. |
| `pages/api/campaigns/ai/plan.ts` | Strategy context validation: duration_weeks (number > 0), platforms (array length > 0), posting_frequency (object). Reject 400 if invalid. Map PlanningValidationError → 400, PlanningGenerationError → 500. |

---

## PIPELINE_UNIFICATION_TEST

| Field | Value |
|-------|-------|
| preview_core_call | `generatePlanPreview` → `generateCampaignPlanCore(input: PlanningInput)` with idea_spine, strategy_context, campaign_direction |
| persisted_core_call | `runCampaignAiPlan` → `generateCampaignPlanCore({ rawOutput, companyId, campaignId, ... })` after orchestrator's generateCampaignPlan |

---

## ERROR_HANDLING_TEST

| Field | Value |
|-------|-------|
| error_type | PlanningValidationError → HTTP 400 |
| error_type | PlanningGenerationError → HTTP 500 |

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
- Focus only on unifying campaign planning pipeline.
