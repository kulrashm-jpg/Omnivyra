# Preview Pipeline Contract Hardening Report

**Module:** Campaign Planner Stabilization  
**Focus:** Preview Pipeline Contract Hardening  
**Product:** Omnivyra  
**Date:** 2026-03-08  

---

## Objective

Remove duplication and ambiguity from the plan preview pipeline so preview and persisted plan generation share the same internal planning logic.

---

## FILES_CREATED

| File | Purpose |
|------|---------|
| `backend/services/campaignPlanCore.ts` | Centralized `generateCampaignPlanCore()` and `parseAndValidatePlanFromRaw()`. Runs AI planning, parse, validate—shared by preview and persisted path. Returns validated weekly plan structure. |
| `backend/types/campaignPlanning.ts` | `PreviewPlanningInput` interface with companyId, idea_spine, strategy_context, campaign_direction. |

---

## FILES_MODIFIED

| File | Fix Applied |
|------|-------------|
| `backend/services/planPreviewService.ts` | Replaced direct calls to generateCampaignPlan, parseAiPlanToWeeks, validateWeeklyPlan with `generateCampaignPlanCore()`. Uses `PreviewPlanningInput` from campaignPlanning types. |
| `backend/services/campaignAiOrchestrator.ts` | Replaced duplicated parse+validate logic with `parseAndValidatePlanFromRaw(raw)`. Main path, repair paths, and alignment regeneration now use shared core. Removed validateWeeklyPlan import. |
| `pages/api/campaigns/ai/plan.ts` | Strict preview detection: `preview_mode === true` only. Removed previewMode alias and temporaryCampaignContext. Reads companyId, idea_spine, strategy_context, campaign_direction from body. Response returns `{ plan }` only. |
| `components/planner/CalendarPlannerStep.tsx` | Sends companyId, idea_spine, strategy_context, campaign_direction at top level instead of temporaryCampaignContext. |

---

## PLAN_GENERATION_PARITY_TEST

| Field | Value |
|-------|-------|
| input | Same idea_spine, strategy_context, campaign_direction, companyId, message |
| preview_weeks | Produced by generateCampaignPlanCore via planPreviewService |
| persisted_weeks | Produced by parseAndValidatePlanFromRaw (same core) in campaignAiOrchestrator |
| result | Identical week structures—both use parseAndValidatePlanFromRaw from campaignPlanCore. |

---

## PREVIEW_CONTRACT_TEST

| Field | Value |
|-------|-------|
| input | `{ preview_mode: true, companyId, idea_spine, strategy_context, campaign_direction, message }` |
| response_shape | `{ plan }` — mode and preview flag removed. |

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
- campaignAiOrchestrator behavior unchanged beyond refactoring duplicated planning logic.
- Focus only on preview pipeline contract hardening.
