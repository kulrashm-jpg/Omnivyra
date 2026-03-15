# Idea Spine Hardening — Campaign Planner Stabilization

**Module:** Campaign Planner Stabilization  
**Focus:** Idea Spine Hardening  
**Product:** Omnivyra  
**Date:** 2025-03-08  
**Status:** Complete

---

## FILES_MODIFIED

| file | fix_applied |
|------|-------------|
| `backend/services/ideaRefinementService.ts` | Added canonical angle taxonomy (EDUCATION, THOUGHT_LEADERSHIP, PROBLEM_AWARENESS, INDUSTRY_TREND, PRODUCT_POSITIONING, CASE_STUDY, COMMUNITY_ENGAGEMENT). AI prompt instructs model to use only these categories. Normalization layer maps AI output into `normalized_angles[]`. Aligned model config with generateCampaignPlan: temperature 0, model gpt-4o-mini, response_format json_object. Returns both suggested_angles and normalized_angles. |
| `pages/api/campaign-planner/refine-idea.ts` | Validation: reject empty idea_text with 400 and message "Campaign idea cannot be empty." |
| `pages/api/campaigns/ai/plan.ts` | Injects campaign_direction into finalCollectedPlanningContext from: body.idea_spine.selected_angle, body.collectedPlanningContext.campaign_direction, or planningInputs.campaign_direction. Ensures runCampaignAiPlan receives selected_angle as campaign_direction. |
| `pages/api/campaigns/planner-finalize.ts` | Persists campaign_direction via saveCampaignPlanningInputs when idea_spine.selected_angle is present. Enables downstream planning to receive consistent campaign context. |
| `backend/services/campaignPlanningInputsService.ts` | Added campaign_direction to CampaignPlanningInputs type, getCampaignPlanningInputs (pull from planning_inputs), and saveCampaignPlanningInputs (store in planning_inputs JSONB). No schema change. |
| `components/planner/plannerSessionStore.ts` | Persist to localStorage (key: omnivyra_planner_session). Fields: idea_spine, strategy_context, campaign_id, plan_snapshot_hash. Restore on mount. Reset clears localStorage. |
| `components/planner/CalendarPlannerStep.tsx` | Finalize guard: requires refined_title (or title), refined_description (or description), selected_angle. Disables finalize button when any missing. Shows specific error message per missing requirement. |
| `components/planner/IdeaSpineStep.tsx` | Stores normalized angle when user selects from suggested angles (uses normalized_angles from API). Ensures selected_angle is canonical for downstream campaign_direction. |

---

## VALIDATION_TEST

| input | result |
|-------|--------|
| POST refine-idea with `idea_text: ""` | 400, "Campaign idea cannot be empty." |
| POST refine-idea with `idea_text: "AI tools for teams"` | 200, refined_title, refined_description, suggested_angles, normalized_angles (canonical categories) |
| Idea spine with title + description, no angle selected | Finalize button disabled; "Select a campaign direction angle in the idea spine step." |
| Idea spine with title + description + selected_angle | Finalize button enabled when strategy complete |
| ai/plan with idea_spine.selected_angle | campaign_direction present in finalCollectedPlanningContext passed to runCampaignAiPlan |
| planner-finalize with idea_spine.selected_angle | saveCampaignPlanningInputs called with campaign_direction |

---

## SESSION_PERSISTENCE_TEST

| reload_test | result |
|-------------|--------|
| Fill idea spine + strategy, reload page | Session restored from localStorage; idea_spine, strategy_context, campaign_id preserved |
| Reset planner | localStorage cleared |
| SSR (no window) | loadPersistedSession/persistSession no-op; no errors |

---

## PROMPT_ALIGNMENT_TEST

| component | status |
|-----------|--------|
| ideaRefinementService | model: OPENAI_MODEL \|\| 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' } — matches generateCampaignPlan config used in campaignAiOrchestrator |
| AI prompt | Instructs canonical categories only; normalized_angles returned |

---

## COMPILATION_STATUS

| field | value |
|-------|-------|
| status | PASSED |
| errors | None |
| warnings | None |

---

## CONSTRAINTS_OBSERVED

- Schema not modified (campaign_direction stored in existing JSONB planning_inputs).
- BOLT pipeline not modified.
- campaignAiOrchestrator not modified.
- Focus limited to Idea Spine module hardening; no new features.
