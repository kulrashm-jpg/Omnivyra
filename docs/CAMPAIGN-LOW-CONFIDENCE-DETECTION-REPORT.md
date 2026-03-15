# Campaign Intelligence — Low Confidence Detection Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Low Confidence Detection  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | Added `low_confidence_ratio` to `RoleDistribution` (count of activities with confidence < 0.5 / total activities). Computed in `computeRoleDistribution`. Added `LOW_CONFIDENCE_RATIO_THRESHOLD = 0.25`. When `low_confidence_ratio > 0.25`, generates suggestion: "Several activities have unclear funnel role." (category: role_distribution, severity: warning). |

---

## LOW_CONFIDENCE_TEST

| item | value |
|------|-------|
| **input** | Activities where >25% have no cta/phase/objective/keyword signals (confidence 0.4 fallback). E.g. 4 activities with empty/minimal metadata → 4/4 = 1.0 ratio. Or 2 low-confidence of 5 activities → 2/5 = 0.4 ratio. |
| **ratio** | `low_confidence_count / total_activities`; 0 when no activities. Triggers suggestion when ratio > 0.25. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |
