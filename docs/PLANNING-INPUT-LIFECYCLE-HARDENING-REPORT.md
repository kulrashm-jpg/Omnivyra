# Planning Input Lifecycle Hardening Report

**Module:** Campaign Planner Stabilization  
**Focus:** Planning Input Lifecycle Hardening  
**Product:** Omnivyra  
**Date:** 2026-03-08  

---

## FILES_MODIFIED

| File | Fix Applied |
|------|-------------|
| `backend/services/campaignPromptBuilder.ts` | Removed `buildPreviewMessages`; inlined prompt construction into `buildCampaignPlanningPrompt`. Removed `Object.freeze`. Added `repair_instruction` block to user content when present. |
| `backend/services/aiPlanningService.ts` | Applied `Object.freeze(input)` before calling prompt builder. Removed `campaignId` from `generateCampaignPlan` call (no longer passed). |
| `backend/types/campaignPlanning.ts` | Added optional `repair_instruction?: string \| null` to `PlanningGenerationInput`. |
| `backend/services/campaignAiOrchestrator.ts` | Replaced all three repair flows: parse failure, validation failure, alignment regeneration. Each now sets `repair_instruction` on a new input object instead of mutating `idea_spine.refined_description`. |

---

## INPUT_IMMUTABILITY_TEST

| Field | Value |
|-------|-------|
| **mutation_attempt** | `Object.freeze(input)` applied in `generateCampaignPlanAI` before any downstream call. Prompt builder no longer freezes; service owns immutability. |
| **result** | PASS – Input is frozen at the boundary; repair flows create new objects with `repair_instruction` only, leaving `idea_spine` unchanged. |

---

## REPAIR_FLOW_TEST

| Field | Value |
|-------|-------|
| **repair_instruction** | All three repair flows (parse failure, validation failure, alignment regeneration) now set `repair_instruction` on a spread copy: `{ ...planningInput, repair_instruction: <text> }`. |
| **result** | PASS – No mutations to `idea_spine.refined_description`. Prompt builder includes `REPAIR INSTRUCTION: <text>` in user content when `repair_instruction` is present. |

---

## COMPILATION_STATUS

| Field | Value |
|-------|-------|
| **status** | success |
| **errors** | none |
| **warnings** | none |

---

## Summary

- **Section 1:** `buildPreviewMessages` removed; prompt built directly in `buildCampaignPlanningPrompt`.
- **Section 2:** `Object.freeze(input)` moved to `aiPlanningService`; removed from prompt builder.
- **Section 3:** `repair_instruction` added to `PlanningGenerationInput`.
- **Section 4:** Orchestrator repair flows use `repair_instruction` instead of mutating `refined_description`.
- **Section 5:** Prompt builder appends `repair_instruction` as a separate block; does not modify `idea_spine`.
- **Section 6:** `campaignId` omitted from AI gateway call (no `campaignId: null` or any value).
- **Section 7:** Repair flows validated to use `repair_instruction` without mutating `PlanningGenerationInput` fields.
