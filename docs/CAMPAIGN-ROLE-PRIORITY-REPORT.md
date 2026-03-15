# Campaign Intelligence — Role Classification Priority Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Role Classification Priority  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | Reordered `classifyActivityRole` logic: (1) CTA signals, (2) Objective signals, (3) Phase signals, (4) Keyword scan. CTA now overrides phase role assignment. |

---

## ROLE_PRIORITY_TEST

| item | value |
|------|-------|
| **input** | Activity with CTA="download", phase="awareness" |
| **classification** | conversion (CTA overrides phase) |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |
