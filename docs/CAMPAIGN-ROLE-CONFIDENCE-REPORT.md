# Campaign Intelligence — Role Confidence Output Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Role Confidence Output  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | Added `RoleClassificationResult`: `{ role, confidence, signals_used }`. Updated `classifyActivityRole` to return this object. Confidence: CTA match 0.9, Objective match 0.8, Phase match 0.7, Keyword match 0.6, Fallback 0.4. `signals_used`: cta \| objective \| phase \| keyword \| content_type \| fallback. Updated `computeRoleDistribution` to use `classifyActivityRole(a).role`. |

---

## ROLE_CONFIDENCE_TEST

| item | value |
|------|-------|
| **activity_input** | `{ cta: "download" }` or `{ objective: "educate" }` or `{ phase: "awareness" }` etc. |
| **output** | `{ role: "conversion"|"education"|"awareness"|..., confidence: 0.9|0.8|0.7|0.6|0.4, signals_used: ["cta"]|["objective"]|["phase"]|["keyword"]|["fallback"] }` |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |
