# Campaign Planner Phase 4 — AI Idea Refinement

**Module:** Campaign Planner  
**Phase:** 4 — AI Idea Refinement  
**Product:** Omnivyra  
**Date:** 2025-03-08  
**Status:** Complete

---

## Executive Summary

AI assistance is now available in the Idea Spine step. Users can enter a free-form campaign idea and use "Refine with AI" to receive refined title, description, and suggested campaign direction angles. The system reuses the existing aiGateway (runCompletionWithOperation) with gpt-4o-mini model configuration.

---

## FILES_CREATED

| file | purpose |
|------|---------|
| `backend/services/ideaRefinementService.ts` | Refines campaign ideas via AI. Accepts idea_text, optional company_profile, recommendation_context. Returns refined_title, refined_description, suggested_angles[]. Uses runCompletionWithOperation with JSON response_format. |
| `pages/api/campaign-planner/refine-idea.ts` | POST API: accepts idea_text, companyId (optional). Fetches company profile when companyId provided. Calls refineCampaignIdea, returns refined_title, refined_description, suggested_angles[]. |

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/aiGateway.ts` | Added contextTypeMap entry: refineCampaignIdea → 'idea_refinement' for audit logging. |
| `components/planner/IdeaSpineStep.tsx` | Added companyId prop. Added "Refine with AI" button; on click calls /api/campaign-planner/refine-idea. Displays refined title/description and suggested campaign direction angles. User can accept (auto-applied), select an angle, or edit manually. |
| `components/planner/plannerSessionStore.ts` | Extended IdeaSpine with raw_input, refined_title, refined_description, selected_angle. |
| `pages/campaign-planner.tsx` | Passes companyId to IdeaSpineStep for profile context in AI refinement. |

---

## API_TEST

| endpoint | payload | result |
|----------|---------|--------|
| POST /api/campaign-planner/refine-idea | `{ idea_text: "AI productivity tools for teams" }` | Returns refined_title, refined_description, suggested_angles[]. |
| POST /api/campaign-planner/refine-idea | `{ idea_text: "...", companyId: "uuid" }` | Same, with company profile context in prompt. |

---

## IDEA_REFINEMENT_TEST

| input_idea | refined_title | angles_generated |
|------------|---------------|-------------------|
| "AI productivity for teams" | AI-generated concise title | 3–5 angles (e.g. Education campaign, Thought leadership, Problem awareness, Industry trend, Product positioning) |
| Empty | — | Default angles returned |

---

## FILES_UNCHANGED_VERIFIED

- `backend/services/campaignAiOrchestrator.ts`
- `backend/services/boltPipelineService.ts`
- Database schema
- `backend/services/companyProfileService.ts` (used via getProfile, not modified)

---

## COMPILATION_STATUS

| field | value |
|-------|-------|
| status | PASSED |
| errors | None |
| warnings | None |

---

## AI_PROMPT_STRUCTURE

- **System:** Campaign strategist role. Refine raw idea → title + description. Suggest 3–5 campaign direction angles. Return JSON.
- **User:** Campaign idea + company context (if available) + recommendation context (if available).
- **Model:** OPENAI_MODEL or gpt-4o-mini (same as generateCampaignPlan).
- **Temperature:** 0.6 (slightly creative for refinement).
- **Response format:** JSON object.

---

## VALIDATION

| mode | status |
|------|--------|
| direct | Works. User enters idea, clicks Refine, receives refinement. |
| recommendation | Works. recommendation_context passed to API; included in prompt. |
| opportunity | Works. opportunity_context passed to API and included in prompt. |

---

## CONSTRAINTS_OBSERVED

- campaignAiOrchestrator not modified.
- BOLT pipeline not modified.
- Database schema not modified.
- Reused existing aiGateway (runCompletionWithOperation).
