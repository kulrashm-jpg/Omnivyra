# Plan Preview Isolation Report

**Module:** Campaign Planner Stabilization  
**Focus:** Plan Preview Isolation  
**Product:** Omnivyra  
**Date:** 2026-03-08  

---

## Objective

Isolate the planner preview pipeline so campaign previews do not depend on campaign creation or execution orchestration.

---

## FILES_CREATED

| File | Purpose |
|------|---------|
| `backend/services/planPreviewService.ts` | Generates campaign plan preview without persistence. Uses internal AI planning via `generateCampaignPlan`, `parseAiPlanToWeeks`, and `validateWeeklyPlan`. Inputs: idea_spine, strategy_context, campaign_direction, companyId, message. Returns plan structure identical to persisted plan. |

---

## FILES_MODIFIED

| File | Fix Applied |
|------|-------------|
| `pages/api/campaigns/ai/plan.ts` | Removed temp campaign creation when campaignId missing. Preview mode: when `preview_mode`/`previewMode` true, no campaignId, and `temporaryCampaignContext` present → call `generatePlanPreview()`, return early. No DB create/delete. |
| `components/planner/CalendarPlannerStep.tsx` | Added `preview_mode: true` to plan API request body in `handleGeneratePreview`. Handles preview response without assuming campaignId: `const weeks = Array.isArray(data?.plan?.weeks) ? data.plan.weeks : []`. |
| `backend/services/ideaRefinementService.ts` | When canonical angle list becomes empty, use deterministic fallback `PROBLEM_AWARENESS`. Removed `defaultNorm` variable. |

---

## PREVIEW_PIPELINE_TEST

| Field | Value |
|-------|-------|
| db_records_created | 0 |
| result | Preview requests (preview_mode=true, no campaignId, temporaryCampaignContext present) call `generatePlanPreview()` only. No Supabase campaigns or campaign_versions inserts. Auth via `getUserCompanyRole` on temporaryCampaignContext.companyId. Returns `{ mode, plan, preview: true }` and exits. |

---

## PLAN_PREVIEW_RESPONSE_TEST

| Field | Value |
|-------|-------|
| input | idea_spine, strategy_context, campaign_direction, companyId, message |
| result | `{ plan: { weeks: [...] } }` — structure identical to persisted plan. Service uses same AI planning logic (generateCampaignPlan, parseAiPlanToWeeks, validateWeeklyPlan) but bypasses DB. |

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
- campaignAiOrchestrator not modified.
- Focus only on isolating preview pipeline.
