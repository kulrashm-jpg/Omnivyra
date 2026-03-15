# Campaign Intelligence — Health Report Traceability Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Health Report Traceability  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | `report_id = \`health_${Date.now()}_${randomUUID()}\``. Added `report_generated_by`: planner \| campaign_engine \| health_scheduler \| manual_trigger (default manual_trigger). Added `activity_count_total` (all activities before filtering). Added `issue_density`: issue_count / analyzed_activity_count, 0 when analyzed_activity_count === 0. Extended CampaignHealthInput with report_generated_by. |

---

## HEALTH_TRACEABILITY_TEST

| item | value |
|------|-------|
| **input** | Evaluation with 12 total activities, 9 after filter, 6 issues. |
| **report_id** | `health_1738886400000_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` format. |
| **activity_count_total** | 12. issue_density: 6/9 ≈ 0.67. report_generated_by: from input or "manual_trigger". |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |
