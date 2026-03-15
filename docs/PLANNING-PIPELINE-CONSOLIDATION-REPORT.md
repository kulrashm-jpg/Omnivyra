# Planning Pipeline Consolidation

**Module:** Campaign Planner Stabilization  
**Focus:** Planning Pipeline Consolidation  
**Product:** Omnivyra  
**Date:** 2025-03-08  
**Status:** Complete

---

## FILES_MODIFIED

| file | fix_applied |
|------|-------------|
| `pages/api/campaign-planner/generate-plan.ts` | **Removed.** Planner now uses pages/api/campaigns/ai/plan.ts exclusively. |
| `pages/api/campaigns/ai/plan.ts` | Unified entry point. Added temporaryCampaignContext support: when campaignId is missing, accepts temporaryCampaignContext with companyId, idea_spine, strategy_context. Creates temp campaign, runs runCampaignAiPlan, returns plan JSON without persisting blueprint, deletes temp campaign. Injects campaign_direction from collectedPlanningContext or temporaryCampaignContext.idea_spine.selected_angle. Skips saveAiCampaignPlan, saveDraftBlueprint, saveCampaignPlanningInputs when in preview mode. |
| `components/planner/CalendarPlannerStep.tsx` | Added "Generate Preview" button. When no campaignId, calls /api/campaigns/ai/plan with temporaryCampaignContext (companyId, idea_spine, strategy_context). Displays generated plan preview. |
| `components/planner/plannerSessionStore.ts` | Removed useRouter and useCompanyContext. PlannerSessionProvider now accepts companyId prop explicitly. Store is framework-independent. Added 24-hour session TTL: stored_at timestamp, loadPersistedSession clears expired sessions. persistSession writes stored_at. |
| `pages/campaign-planner.tsx` | Added CampaignPlannerWithSession wrapper that uses useRouter and useCompanyContext to resolve companyId, passes it to PlannerSessionProvider. |
| `backend/services/ideaRefinementService.ts` | Strengthened prompt: model MUST output only canonical strings (EDUCATION, THOUGHT_LEADERSHIP, etc.). Removed ANGLE_ALIAS_MAP, normalizeAngle, normalizeAngles. Post-parse: filter to CANONICAL_SET only, no mapping. |

---

## PLAN_PREVIEW_TEST

| input | result |
|-------|--------|
| POST /api/campaigns/ai/plan with temporaryCampaignContext: { companyId, idea_spine, strategy_context }, mode: 'generate_plan' | 200, plan.weeks returned, no blueprint persisted, temp campaign deleted |
| CalendarPlannerStep: user completes idea spine + strategy, clicks "Generate Preview" | Plan preview displayed without campaignId |

---

## SESSION_TTL_TEST

| session_age | result |
|-------------|--------|
| < 24 hours | Session restored from localStorage |
| > 24 hours | loadPersistedSession removes key, returns null, fresh state |
| stored_at missing (legacy) | Treated as expired (0), cleared |

---

## PROMPT_CONTRACT_TEST

| angles_returned | status |
|-----------------|--------|
| Model outputs EDUCATION, THOUGHT_LEADERSHIP, etc. | Passed through (filter keeps only canonical) |
| Model outputs non-canonical string | Filtered out; defaultNorm used if empty |
| No post-generation normalization/mapping | Removed; prompt enforces canonical output |

---

## COMPILATION_STATUS

| field | value |
|-------|-------|
| status | PASSED |
| errors | None |
| warnings | None |

---

## CONSTRAINTS_OBSERVED

- Schema not modified.
- BOLT pipeline not modified.
- campaignAiOrchestrator not modified.
- Single entry point: ai/plan.ts for all plan generation.
