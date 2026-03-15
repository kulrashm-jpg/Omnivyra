# Idea Spine Contract Enforcement

**Module:** Campaign Planner Stabilization  
**Focus:** Idea Spine Contract Enforcement  
**Product:** Omnivyra  
**Date:** 2025-03-08  
**Status:** Complete

---

## FILES_MODIFIED

| file | fix_applied |
|------|-------------|
| `backend/services/ideaRefinementService.ts` | Removed suggested_angles from API response. Returns only normalized_angles (canonical categories). IdeaRefinementResult now has refined_title, refined_description, normalized_angles. |
| `pages/api/campaign-planner/refine-idea.ts` | No change needed; passes through service result. API now returns only normalized_angles. |
| `pages/api/campaign-planner/generate-plan.ts` | **Created.** Planner-specific plan generation. Injects campaign_direction from idea_spine.selected_angle into collectedPlanningContext. Calls runCampaignAiPlan. Requires companyId and campaignId. Planner plan generation must use this API only. |
| `pages/api/campaigns/ai/plan.ts` | Removed campaign_direction injection. Removed idea_spine from body destructuring. Planner-specific context (campaign_direction) now lives only in campaign-planner/generate-plan.ts. |
| `components/planner/IdeaSpineStep.tsx` | Uses normalized_angles as sole selectable options. Removed suggestedAngles state. selected_angle can only be chosen from normalized_angles (validated in handleSave). Continue disabled when normalizedAngles exist and no angle selected. No manual campaign direction input. |
| `components/planner/CalendarPlannerStep.tsx` | Removed fallback: hasRefinedTitle/hasRefinedDescription now require strictly spine.refined_title and spine.refined_description (no fallback to title/description). |
| `components/planner/plannerSessionStore.ts` | localStorage key changed from `omnivyra_planner_session` to `omnivyra_planner_session_{companyId}`. Uses useRouter and useCompanyContext to resolve companyId. Falls back to `default` when no company. Prevents cross-company session collisions. |

---

## ANGLE_CONTRACT_TEST

| angles_returned | storage_value |
|-----------------|---------------|
| API returns only normalized_angles (e.g. EDUCATION, THOUGHT_LEADERSHIP, PRODUCT_POSITIONING) | selected_angle stored only when it exists in normalized_angles; otherwise undefined |
| UI displays normalized_angles as buttons; user selects one | selected_angle = canonical value (e.g. EDUCATION) |

---

## FINALIZE_GUARD_TEST

| missing_field | result |
|---------------|--------|
| refined_title | Finalize disabled; "Complete the idea spine step with title and description." |
| refined_description | Finalize disabled; same message |
| selected_angle | Finalize disabled; "Select a campaign direction angle in the idea spine step." |
| All three present | Finalize enabled (when strategy complete and companyId set) |

---

## SESSION_ISOLATION_TEST

| companyA | companyB |
|----------|----------|
| Session for company A stored at omnivyra_planner_session_{companyA_id} | Session for company B stored at omnivyra_planner_session_{companyB_id} |
| Switch to company B loads B's session; A's session unchanged | Switch to company A loads A's session; B's session unchanged |
| No cross-company data collision | Isolated per company |

---

## VALIDATION_TEST

Planner cannot finalize without canonical angle:

- Idea Spine Continue requires selected_angle when normalized_angles exist (from Refine with AI).
- CalendarPlannerStep Finalize requires hasSelectedAngle (strict).
- selected_angle is validated to be in normalized_angles before save; invalid values are discarded.

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
- Focus limited to Idea Spine contract enforcement; no new functionality added.
