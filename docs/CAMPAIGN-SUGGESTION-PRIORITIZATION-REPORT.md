# Campaign Intelligence — Suggestion Prioritization Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Suggestion Prioritization  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | Extended `HealthSuggestion` with `priority: number`. Updated `_s()` to accept optional 4th parameter (default 10). Priority rules: missing_objective → 1, missing_cta → 2, missing_phase → 3. Other suggestions use default priority 10. |

---

## SUGGESTION_PRIORITY_TEST

| item | value |
|------|-------|
| **input** | Campaign with low-confidence activities: e.g. 2 missing objective, 1 missing cta, 3 missing phase. |
| **output** | Suggestions include priority: "X activities lack objective alignment." (priority 1), "X activities lack CTA alignment." (priority 2), "X activities lack phase alignment." (priority 3). Lower number = higher priority. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |
