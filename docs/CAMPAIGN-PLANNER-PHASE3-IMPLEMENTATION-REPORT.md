# Campaign Planner Phase 3 — Activity Structure + Daily Plan Handoff

**Module:** Campaign Planner Implementation  
**Phase:** 3 — Activity Structure + Daily Plan Handoff  
**Product:** Omnivyra  
**Date:** 2025-03-08  
**Status:** Complete

---

## Executive Summary

Phase 3 completes the planner workflow so that once a campaign plan is generated, the planner produces activity structure, hands the campaign into the execution system (daily plans → activity workspace → campaign calendar), and updates campaign status to execution_ready.

---

## FILES_CREATED

| file | purpose |
|------|---------|
| `backend/services/plannerActivityCardService.ts` | Transforms plan weeks → activity cards with execution_category (AI_GENERATED, AI_ASSISTED, CREATOR_REQUIRED). Maps execution category to ai_generated for daily_content_plans. |
| `pages/api/campaigns/planner-finalize.ts` | Planner finalization API: creates campaign (if new), saves blueprint from strategy, runs generateWeeklyStructure, updates campaign status, returns campaign_id for redirect. |

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `pages/api/campaigns/generate-weekly-structure.ts` | Added execution category → ai_generated mapping. Import plannerActivityCardService; set ai_generated from getExecutionCategoryForContentType + executionCategoryToAiGenerated when building daily_content_plans rows. AI-capable content types (post, article, thread) → true; creator-required (video, reel, carousel) → false. |
| `components/planner/CalendarPlannerStep.tsx` | Added "Finalize Campaign Plan" step. Button calls POST /api/campaigns/planner-finalize with companyId, idea_spine, strategy_context, campaignId. On success, invokes onFinalize(campaign_id) or redirects to /campaign-calendar/{id}. Disabled when companyId or strategy_context missing. |
| `pages/campaign-planner.tsx` | Added useCompanyContext for selectedCompanyId fallback when query.companyId absent. Passes resolved companyId to CalendarPlannerStep. Passes onFinalize callback to redirect to /campaign-calendar/{campaign_id}. |

---

## SERVICE_INTEGRATION

| service | integration_status |
|---------|--------------------|
| `campaignPlanStore` | Used via saveCampaignBlueprintFromLegacy in planner-finalize. Blueprint saved to twelve_week_plan before generateWeeklyStructure. |
| `generateWeeklyStructureService` | Re-exports generateWeeklyStructure from generate-weekly-structure.ts. Called directly from planner-finalize with campaignId, companyId, weeks. |
| `daily_content_plans` | Populated by generateWeeklyStructure. Rows include platform, content_type, topic, ai_generated (from execution category mapping). |
| `activity-workspace` | Compatible. Expects platform, content_type, topic/theme, ai_generated. daily_content_plans and daily-plans API provide these. |
| `campaign-calendar` | Redirect target: /campaign-calendar/{campaign_id}. Route exists at pages/campaign-calendar/[id].tsx. |
| `contentGenerationPipeline` | Not modified. Compatible with existing daily_content_plans model. |
| `schedulerService` | Not modified per constraints. |

---

## PLAN_TO_ACTIVITY_TEST

| campaign_id | activities_generated | weeks |
|-------------|-----------------------|-------|
| (on finalize) | Yes (via generateWeeklyStructure) | duration_weeks from strategy_context |

Planner finalize builds structured weeks from strategy_context (duration_weeks, platforms, posting_frequency, content_mix), saves blueprint, runs generateWeeklyStructure for all weeks. daily_content_plans rows are created with platform, content_type, topic, ai_generated.

---

## WORKSPACE_COMPATIBILITY_TEST

| activity_workspace_load | result |
|-------------------------|--------|
| Daily plans from campaign | Compatible. daily_content_plans has platform, content_type, topic; ai_generated set from execution category. activity-workspace uses dailyRaw.ai_generated when present. |

---

## FILES_UNCHANGED_VERIFIED

- `backend/services/campaignAiOrchestrator.ts`
- `backend/services/boltPipelineService.ts`
- `backend/scheduler/schedulerService.ts`
- Database schema (daily_content_plans, campaigns)
- `pages/campaign-calendar/[id].tsx`
- `pages/activity-workspace.tsx` (no changes; compatibility verified)

---

## COMPILATION_STATUS

| field | value |
|-------|-------|
| status | FAILED (pre-existing errors; Phase 3 changes introduce one fixable path) |
| errors | `planner-finalize.ts`: import path corrected to `./generate-weekly-structure`. Pre-existing: responsePolicyEngine.ts, ConversationView.tsx, PlannerEntryRouter.tsx. |
| warnings | None from Phase 3. |

---

## EXECUTION_CATEGORY_MAPPING

| execution_category | ai_generated |
|--------------------|--------------|
| AI_GENERATED | true |
| AI_ASSISTED | true |
| CREATOR_REQUIRED | false |

Content types mapped to CREATOR_REQUIRED: video, reel, carousel, podcast, livestream. All others → AI_ASSISTED → ai_generated=true.

---

## FINALIZATION_FLOW

1. User completes Idea Spine + Strategy steps.
2. User clicks "Finalize Campaign Plan" on Calendar step.
3. POST /api/campaigns/planner-finalize with companyId, idea_spine, strategy_context.
4. API creates campaign (if new), builds structured weeks from strategy, saves blueprint, runs generateWeeklyStructure for all weeks.
5. Campaign updated: current_stage=execution_ready, blueprint_status=ACTIVE.
6. Redirect to /campaign-calendar/{campaign_id}.

---

## CONSTRAINTS_OBSERVED

- Database schema: not modified.
- campaignAiOrchestrator: not modified.
- BOLT pipeline: not modified.
- schedulerService: not modified.
- Reused existing daily_content_plans execution model.
