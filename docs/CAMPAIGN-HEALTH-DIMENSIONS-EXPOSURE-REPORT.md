# Campaign Intelligence — Health Dimensions Exposure Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Health Dimensions Exposure  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | Added `health_dimensions`: design (avg of content_mix, cadence, audience), execution (execution_cadence_score), distribution (avg of platform_distribution, role_balance), metadata (metadata_completeness_score), narrative (narrative_score). Added `dimension_status`: per-dimension status; &gt;=80 good, 60–79 warning, &lt;60 critical. |

---

## HEALTH_DIMENSIONS_TEST

| item | value |
|------|-------|
| **input** | Campaign with narrative 85, design components avg 65, execution 90, distribution 70, metadata 50. |
| **health_dimensions** | narrative: 85, design: 65, execution: 90, distribution: 70, metadata: 50. |
| **dimension_status** | narrative: good, design: warning, execution: good, distribution: warning, metadata: critical. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |
