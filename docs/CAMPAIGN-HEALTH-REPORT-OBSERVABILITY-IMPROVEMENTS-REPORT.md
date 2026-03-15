# Campaign Intelligence — Health Report Observability Improvements Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence — Health Report Observability Improvements  
**Date:** 2025-03-08  

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | `analyzed_activity_count` excludes activities where `source === "system_generated"`. Added `low_confidence_count` to RoleDistribution and CampaignHealthReport. `evaluation_start = Date.now()` at start; `evaluation_duration_ms = Date.now() - evaluation_start` at end. `CAMPAIGN_HEALTH_SCHEMA_VERSION = 1`; `health_version = CAMPAIGN_HEALTH_SCHEMA_VERSION`. |

---

## HEALTH_OBSERVABILITY_TEST

| item | value |
|------|-------|
| **input** | Campaign with 12 activities (3 system_generated), 4 low-confidence. |
| **analyzed_activity_count** | 9 (excludes 3 system_generated). |
| **low_confidence_count** | 4 (count of activities with confidence < 0.5). |
| **evaluation_duration_ms** | Millisecond duration of evaluateCampaignHealth execution. |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |
