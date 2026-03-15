# Campaign Intelligence — Health Report Diagnostics Expansion Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Health Report Diagnostics Expansion  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | Added `hidden_issue_count = issue_count - visible_issue_count`. Extended report with `missing_cta_total`, `missing_objective_total`, `missing_phase_total` (from role_distribution). Replaced `low_confidence_activity_ids` with `low_confidence_activities: { id, predicted_role, confidence }[]`. Added `evaluated_at: new Date().toISOString()`. Introduced `LowConfidenceActivity` interface. |

---

## HEALTH_DIAGNOSTICS_TEST

| item | value |
|------|-------|
| **input** | Campaign with 15 suggestions, 5 low-confidence activities. |
| **hidden_issue_count** | 15 - 10 = 5 (when MAX_HEALTH_SUGGESTIONS=10). |
| **metadata_breakdown** | `missing_cta_total`, `missing_objective_total`, `missing_phase_total` from RoleDistribution. `low_confidence_activities`: `[{ id, predicted_role, confidence }, ...]`. `evaluated_at`: ISO timestamp. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |
