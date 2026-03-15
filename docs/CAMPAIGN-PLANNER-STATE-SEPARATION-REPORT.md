# Campaign Planner Architecture — Planner State Logical Separation Report

**Product:** Omnivyra  
**Module:** Planner State Logical Separation  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `components/planner/plannerSessionStore.ts` | Created `CampaignDesign` (idea_spine, campaign_brief, campaign_structure) and `ExecutionPlan` (strategy_context, calendar_plan, activity_cards). Replaced flat state with `campaign_design` and `execution_plan`. Updated all setters to write to nested objects. `setCalendarPlan` syncs `activity_cards` from `calendar_plan.activities`. Persist/load migrate flat legacy payload to nested structure. |
| `components/planner/CampaignContextBar.tsx` | Reads from `state.campaign_design` (idea_spine, campaign_brief). Uses `state.execution_plan?.strategy_context` for audience/goal fallback. |
| `components/planner/PlanningCanvas.tsx` | Reads `campaign_structure` from `state.campaign_design`; reads `calendar_plan` and `activity_cards` from `state.execution_plan`. |
| `components/planner/CampaignParametersTab.tsx` | Reads `state.execution_plan?.strategy_context`; reads `state.campaign_design?.idea_spine` for API calls. |
| `components/planner/AIPlanningAssistantTab.tsx` | Same: `campaign_design.idea_spine`, `execution_plan.strategy_context`. |
| `components/planner/CalendarPlannerStep.tsx` | Migrated to `campaign_design` and `execution_plan`. |
| `components/planner/IdeaSpineStep.tsx` | Reads `state.campaign_design?.idea_spine`. |
| `components/planner/StrategyBuilderStep.tsx` | Reads `state.execution_plan?.strategy_context`. |
| `pages/campaign-planner.tsx` | FinalizeSection reads `campaign_design.idea_spine`, `execution_plan.strategy_context`, `execution_plan.calendar_plan`. |
| `components/planner/index.ts` | Exported `CampaignDesign`, `ExecutionPlan`. |

---

## STATE_STRUCTURE_TEST

| item | result |
|------|--------|
| **campaign_design** | `{ idea_spine, campaign_brief, campaign_structure }`. Design layer; CampaignContextBar reads/writes here. |
| **execution_plan** | `{ strategy_context, calendar_plan, activity_cards }`. Scheduling layer; PlanningCanvas uses calendar_plan; StrategyAssistantPanel tabs use strategy_context. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | Linter clean |
| **errors** | None |
| **warnings** | None |

---

## CONSTRAINTS OBSERVED

- No backend services modified.
- No database schema modified.
- No AI planning pipeline modified.
- UI architecture only.
