# Campaign Intelligence — Targeted Low-Confidence Suggestions Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Targeted Low-Confidence Suggestions  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | Replaced single generic low-confidence suggestion with targeted suggestions based on diagnostic counts. When `low_confidence_ratio > 0.25`: add "X activities lack CTA alignment." if `missing_cta_count > 0`; add "X activities lack objective alignment." if `missing_objective_count > 0`; add "X activities lack phase alignment." if `missing_phase_count > 0`. Each non-zero count yields a separate suggestion. |

---

## LOW_CONFIDENCE_TARGETED_TEST

| item | value |
|------|-------|
| **input** | Activities where >25% have low confidence and diagnostic counts vary. E.g. 3 low-confidence activities: 2 missing cta, 3 missing objective, 1 missing phase. |
| **suggestions** | `"2 activities lack CTA alignment."`, `"3 activities lack objective alignment."`, `"1 activity lacks phase alignment."` (one per non-zero count; singular when count = 1). If all counts zero, no low-confidence suggestions. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |
