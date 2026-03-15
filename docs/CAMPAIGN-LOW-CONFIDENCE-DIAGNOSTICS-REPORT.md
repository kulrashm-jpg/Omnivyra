# Campaign Intelligence — Low Confidence Diagnostics Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Low Confidence Diagnostics  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | Extended `RoleDistribution` with `missing_cta_count`, `missing_objective_count`, `missing_phase_count` (counts of low-confidence activities lacking each field). Updated suggestion message to: "Several activities lack CTA, objective, or phase alignment." |

---

## LOW_CONFIDENCE_DIAGNOSTIC_TEST

| item | value |
|------|-------|
| **input** | Activities with confidence < 0.5 (fallback): e.g. `[{ }, { cta: "x" }, { phase: "x" }]` — first has no cta/objective/phase; second has cta but doesn't match conversion list; third has phase but doesn't match. For fallback activities, counts increment when corresponding field is empty. |
| **result** | `role_distribution.missing_cta_count`, `missing_objective_count`, `missing_phase_count` reflect diagnostics. Suggestion shown when `low_confidence_ratio > 0.25`. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |
