# Campaign Intelligence — Weighted Role Distribution Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Weighted Role Distribution  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | Updated `computeRoleDistribution`: (1) `by_role[role] += confidence` instead of counting by 1; (2) activities with `confidence < 0.5` excluded from distribution; (3) `total` = sum of confidence contributions; (4) `percentages` based on weighted total. Added `LOW_CONFIDENCE_THRESHOLD = 0.5`. |

---

## ROLE_DISTRIBUTION_TEST

| item | value |
|------|-------|
| **input** | `[{ cta: "download" }, { phase: "awareness" }, { objective: "educate" }]` (or activities with varying confidence) |
| **result** | `by_role` values are sums of confidence (e.g. CTA 0.9, phase 0.7, objective 0.8). Activities with confidence < 0.5 excluded. `total` = sum of `by_role`. `percentages` = share of weighted total. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |
