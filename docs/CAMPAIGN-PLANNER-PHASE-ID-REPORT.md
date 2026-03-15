# Campaign Planner Architecture — Phase Identity Stabilization Report

**Product:** Omnivyra  
**Module:** Phase Identity Stabilization  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `components/planner/plannerSessionStore.ts` | Added required `id: string` to `CampaignStructurePhase`. |
| `components/planner/calendarPlanConverter.ts` | Added `generatePhaseId(index, weekNum)` for stable ids. When creating phases, assigns `id`. Builds `weeksWithPhaseId` array; each week object includes `phase_id: currentPhase?.id ?? null`. `calendar_plan.weeks` now stores enriched weeks with `phase_id`. |
| `components/planner/PlanningCanvas.tsx` | Phase edits preserve `id` (updates exclude id; merge keeps existing). `PhaseCard` key uses `phase.id`. `updatePhase` adds legacy id when missing for backward compatibility. Week View groups weeks by `phase_id`; renders phase header per group; weeks without `phase_id` go to `__untyped__` group. |

---

## PHASE_ID_TEST

| item | result |
|------|--------|
| **phase_ids** | Format `phase-{index}-w{weekNum}`. Generated when phase is created in converter. Required on `CampaignStructurePhase`. |
| **week_phase_links** | Each week in `calendar_plan.weeks` has `phase_id` (string or null). Set during conversion loop from `currentPhase?.id`. |

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
- UI architecture only.
