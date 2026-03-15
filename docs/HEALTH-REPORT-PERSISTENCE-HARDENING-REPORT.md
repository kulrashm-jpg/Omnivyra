# Health Report Persistence Hardening Report

**Module:** Campaign Intelligence  
**Focus:** Health Report Persistence Hardening  
**Product:** Omnivyra  
**Date:** 2026-03-09

## Objective

Ensure CampaignHealthReport persistence is complete and reliable.

---

## FILES_MODIFIED

| File | Change Summary |
|------|----------------|
| `pages/api/campaigns/[id]/health.ts` | Removed fallback reconstruction; returns only persisted report_json; 404 when no report_json; triggers background refresh when evaluated_at &gt; 24h |
| `database/campaign_health_reports_report_json.sql` | Added campaign_version_id, evaluated_at, health_score, health_status, updated_at; created_at SET DEFAULT now(); indexes: campaign_id, campaign_version, created_at DESC; UNIQUE campaign_health_version_unique |
| `backend/db/campaignVersionStore.ts` | saveCampaignHealthReport: campaign_version_id, evaluated_at, health_score, health_status, updated_at; enforceHealthReportRetention (keep latest 20 per campaign) |
| `backend/jobs/campaignHealthEvaluationJob.ts` | Build activity_diagnostics[]; pass health_score, health_status; report size guard (MAX 200KB before save) |

---

## DB_STRUCTURE_TEST

| Field | Status |
|-------|--------|
| **health_score_column** | health_score INTEGER; populated from CampaignHealthReport.health_score when saving |
| **health_status_column** | health_status TEXT; populated from CampaignHealthReport.health_status when saving |

---

## PERSISTENCE_TEST

| Field | Status |
|-------|--------|
| **report_json_saved** | report_json is mandatory for successful response; API returns 404 when absent |
| **activity_diagnostics_present** | report_json includes activity_diagnostics[] with: id, missing_cta, missing_objective, missing_phase, predicted_role, confidence, low_confidence_role |

---

## COMPILATION_STATUS

| Field | Status |
|-------|--------|
| **status** | Linter clean on modified files |
| **errors** | None |
| **warnings** | None |

---

## activity_diagnostics Structure

```json
{
  "id": "execution_id",
  "missing_cta": true,
  "missing_objective": false,
  "missing_phase": true,
  "predicted_role": "awareness",
  "confidence": 0.3,
  "low_confidence_role": true
}
```

---

## Migration

Run `database/campaign_health_reports_report_json.sql`:
- report_json JSONB
- campaign_version_id UUID
- evaluated_at TIMESTAMPTZ DEFAULT now()
- health_score INTEGER
- health_status TEXT
- idx_campaign_health_reports_campaign_id on (campaign_id)
- idx_campaign_health_reports_campaign_version on (campaign_id, campaign_version_id)
- campaign_health_version_unique UNIQUE (campaign_id, campaign_version_id)
- idx_campaign_health_reports_created_at on (campaign_id, created_at DESC)

## Operational Hardening

- **Report size guard:** MAX_HEALTH_REPORT_SIZE = 200_000 bytes; throws before save if exceeded
- **Retention:** Keep only latest 20 reports per campaign; enforced after each save
- **created_at default:** SET DEFAULT now()
- **updated_at column:** TIMESTAMPTZ DEFAULT now(); set to now() on each health refresh (insert)

## SCHEMA_FINALIZATION_TEST

| Field | Status |
|-------|--------|
| **created_at_default** | created_at SET DEFAULT now() (database/campaign_health_reports_report_json.sql) |
| **updated_at_column** | updated_at TIMESTAMPTZ DEFAULT now(); set to now() on health refresh via saveCampaignHealthReport |

---

## Health Persistence Finalization Report

**Module:** Campaign Intelligence  
**Focus:** Health Persistence Finalization  
**Product:** Omnivyra  

### FILES_MODIFIED

| File | change_summary |
|------|----------------|
| `database/campaign_health_reports_report_json.sql` | created_at SET DEFAULT now(); updated_at TIMESTAMPTZ DEFAULT now() |
| `backend/db/campaignVersionStore.ts` | saveCampaignHealthReport sets updated_at: now on insert (health refresh) |

### SCHEMA_FINALIZATION_TEST

| Field | Value |
|-------|-------|
| **created_at_default** | ALTER COLUMN created_at SET DEFAULT now() |
| **updated_at_column** | updated_at TIMESTAMPTZ DEFAULT now() |

### COMPILATION_STATUS

| Field | Value |
|-------|-------|
| **status** | Pass |
| **errors** | None |
| **warnings** | None |
