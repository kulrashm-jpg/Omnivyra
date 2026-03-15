# Campaign Intelligence — Health Report Accuracy Improvements Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Health Report Accuracy Improvements  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | Track `total_issue_count` before slice. Return `issue_count` (= total) and `visible_issue_count` (= after slice). Exclude activities with `source === "system_generated"` from metadata completeness. Low-confidence id: `execution_id || id || \`activity-${i}\``. |
| `components/planner/CampaignHealthPanel.tsx` | Added `visible_issue_count` to report interface and API mapping. Header subtitle: when `issue_count > visible_issue_count` show "Showing top {visible_issue_count}" else "Design & execution evaluation". |

---

## HEALTH_ACCURACY_TEST

| item | value |
|------|-------|
| **input** | Campaign with 15 suggestions, 8 activities (2 with source=system_generated). |
| **issue_count** | 15 (total before slice). |
| **visible_issue_count** | 10 (after slice to MAX_HEALTH_SUGGESTIONS). Metadata completeness excludes system_generated activities. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |
