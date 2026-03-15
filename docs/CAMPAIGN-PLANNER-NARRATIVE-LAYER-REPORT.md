# Campaign Planner Architecture — Campaign Narrative Layer Report

**Product:** Omnivyra  
**Module:** Campaign Narrative Layer  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `components/planner/plannerSessionStore.ts` | Added `campaign_structure` (phases, narrative) and `CampaignStructure`, `CampaignStructurePhase` types. Removed `phases` from `CalendarPlan`; `CalendarPlan` now has only weeks, days, activities. Added `setCampaignStructure`. Persist/restore campaign_structure. |
| `components/planner/calendarPlanConverter.ts` | Extracts narrative signals from AI weeks (phase_label, theme, narrative_summary). Returns `{ campaign_structure, calendar_plan }`; `calendar_plan` no longer includes phases. Populates `campaign_structure.phases` from week phase_label/theme. Builds `campaign_structure.narrative` from phase labels. |
| `components/planner/PlanningCanvas.tsx` | Campaign View renders `campaign_structure.phases` (with narrative and narrative_hint). Fallback to weeks when phases empty. Week View renders `calendar_plan.weeks`. |
| `components/planner/AIPlanningAssistantTab.tsx` | Sets both `campaign_structure` and `calendar_plan` from converter result. |
| `components/planner/CampaignParametersTab.tsx` | Same: sets both from converter result. |
| `components/planner/CalendarPlannerStep.tsx` | Same: sets both from converter result; clears both on error. |
| `components/planner/index.ts` | Exported `CampaignStructure`, `CampaignStructurePhase`; removed `CalendarPlanPhase`. |

---

## STRUCTURE_TEST

| item | result |
|------|--------|
| **campaign_structure** | Holds `phases` (label, week_start, week_end, narrative_hint) and `narrative` (string from phase labels). Populated during AI plan conversion. |
| **calendar_plan** | Holds only `weeks`, `days`, `activities`. Phases removed. |

---

## CANVAS_RENDER_TEST

| item | result |
|------|--------|
| **campaign_view** | Renders `campaign_structure.phases` with label, week range, narrative_hint. Shows `campaign_structure.narrative` when present. Fallback to weeks when phases empty. |
| **week_view** | Renders `calendar_plan.weeks` with week number, label, activity chips. |

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
- No AI planning pipeline modified.
- No database schema modified.
- UI architecture alignment only.
