# Campaign Intelligence — Health Report Safety Improvements Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Health Report Safety Improvements  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | `hidden_issue_count = Math.max(0, issue_count - visible_issue_count)`. Added `MAX_LOW_CONFIDENCE_ACTIVITIES = 20`; `low_confidence_activities` truncated via `.slice(0, MAX_LOW_CONFIDENCE_ACTIVITIES)`. Added `low_confidence_ratio` to CampaignHealthReport (from role_distribution). |

---

## HEALTH_REPORT_SAFETY_TEST

| item | value |
|------|-------|
| **input** | Campaign with 15 suggestions (visible 10), 25 low-confidence activities. |
| **hidden_issue_count** | `Math.max(0, 15 - 10) = 5`. Guard prevents negative when edge cases occur. |
| **low_confidence_ratio** | Exposed at report level: `role_distribution.low_confidence_ratio` (low_confidence_count / total_activities). `low_confidence_activities` capped at 20. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |
