# Planning Core Contract Enforcement Report

**Module:** Campaign Planner Stabilization  
**Focus:** Planning Core Contract Enforcement  
**Product:** Omnivyra  
**Date:** 2026-03-08  

---

## Objective

Enforce strict contracts around the centralized campaign planning core so all planning inputs and outputs follow a single schema.

---

## FILES_MODIFIED

| File | Fix Applied |
|------|-------------|
| `pages/api/campaigns/ai/plan.ts` | Added validation for preview_mode: companyId, idea_spine.refined_title, idea_spine.refined_description, strategy_context, campaign_direction. Returns HTTP 400 if any missing. Derives message from idea_spine when short for moderation. Catches planPreviewService errors and returns 400. |
| `backend/services/campaignPlanCore.ts` | Made `parseAndValidatePlanFromRaw` internal (removed export). Only `generateCampaignPlanCore` (and `ParsedPlan` type) exported. |
| `backend/services/planPreviewService.ts` | Removed `message` from PlanPreviewInput. Added runtime validation: reject if companyId, idea_spine, strategy_context, or campaign_direction missing. Throws Error with clear message. Content built only from buildContextBlock (PreviewPlanningInput). |
| `backend/services/campaignAiOrchestrator.ts` | Reverted to inline parse+validate using parseAiPlanToWeeks and validateWeeklyPlan (parseAndValidatePlanFromRaw no longer exported). Behavior unchanged. |
| `components/planner/CalendarPlannerStep.tsx` | Added strategy_context validation: duration_weeks (number > 0), platforms (non-empty array), posting_frequency (object). `canGeneratePreview` requires these. Preview button and handleGeneratePreview guard on canGeneratePreview. |

---

## INPUT_VALIDATION_TEST

| Field | Value |
|-------|-------|
| missing_field | Any of: companyId, idea_spine.refined_title, idea_spine.refined_description, strategy_context, campaign_direction |
| result | HTTP 400 with error message, e.g. "companyId is required for plan preview", "idea_spine.refined_title is required for plan preview", etc. |

---

## CORE_SERVICE_EXPORT_TEST

| Field | Value |
|-------|-------|
| exports | `generateCampaignPlanCore`, `ParsedPlan` (type), `GeneratePlanCoreParams` (type) |
| internal | `parseAndValidatePlanFromRaw` (not exported) |

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
- campaignAiOrchestrator behavior unchanged beyond enforcing planning core contracts.
- Focus only on enforcing planning core contracts.
