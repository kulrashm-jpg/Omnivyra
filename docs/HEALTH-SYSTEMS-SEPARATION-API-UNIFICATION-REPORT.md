# Health Systems Separation + API Unification Report

**Module:** Campaign Intelligence Architecture  
**Focus:** Health Systems Separation + API Unification  
**Product:** Omnivyra  
**Date:** 2026-03-09

## Objective

Finalize architecture by:
1. Keeping Campaign Health and Engagement Health as separate systems
2. Unifying API structure
3. Ensuring UI consumes persisted reports (no UI-triggered evaluation)
4. Introducing shared intelligence layer usage

**Constraint:** Do NOT change evaluation logic.

---

## FILES_CREATED

| File | Purpose |
|------|---------|
| `pages/api/campaigns/[id]/health.ts` | GET endpoint returning persisted CampaignHealthReport from campaign_health_reports |
| `pages/api/campaigns/[id]/engagement-health.ts` | GET endpoint returning EngagementHealthReport; campaign-scoped; used by Engagement Inbox, Audience Insights, Content Performance |
| `database/campaign_health_reports_report_json.sql` | Migration: add report_json JSONB column to persist full CampaignHealthReport |

---

## FILES_MODIFIED

| File | Change Summary |
|------|----------------|
| `backend/db/campaignVersionStore.ts` | Added optional `report_json` to saveCampaignHealthReport; persists full CampaignHealthReport |
| `backend/jobs/campaignHealthEvaluationJob.ts` | Added buildActivityCardsFromBlueprint for real execution_ids; passes report_json to save; uses CalendarPlanActivityInput |
| `components/planner/CampaignHealthPanel.tsx` | Replaced POST evaluation with GET /api/campaigns/{campaignId}/health; added campaignId prop; only fetches when campaignId present; removed UI-triggered evaluation |
| `components/planner/plannerSessionStore.ts` | Added health_flags to PlannerHealthReport |
| `pages/campaign-planner.tsx` | Passes campaignId to CampaignHealthPanel |
| `pages/activity-workspace.tsx` | Replaced intelligence-health fetch with GET /api/campaigns/{campaignId}/health |
| `components/planner/PlanningCanvas.tsx` | (No changes) Uses health_report from plannerSessionStore; badges: Missing CTA (red), Objective (orange), Phase (yellow), Low Confidence (purple) |

---

## FILES_DELETED

| File | Reason |
|------|--------|
| `pages/api/campaigns/[id]/intelligence-health.ts` | Removed ambiguous endpoint per task |

---

## API_STRUCTURE_TEST

| Field | Status |
|-------|--------|
| **campaign_health_endpoint** | GET /api/campaigns/[id]/health — returns persisted CampaignHealthReport (report_json if present, else constructed from status/confidence/issues/scores) |
| **engagement_health_endpoint** | GET /api/campaigns/[id]/engagement-health — returns EngagementHealthReport; independent of Campaign Health |

---

## UI_FETCH_TEST

| Field | Status |
|-------|--------|
| **health_panel_fetch** | CampaignHealthPanel fetches GET /api/campaigns/{campaignId}/health only when campaignId present; no POST evaluation |
| **activity_workspace_fetch** | Activity workspace fetches GET /api/campaigns/{campaignId}/health; uses low_confidence_activities, score_breakdown, health_flags for diagnostics |

---

## COMPILATION_STATUS

| Field | Status |
|-------|--------|
| **status** | Pending full build |
| **errors** | None from linter on modified files |
| **warnings** | None reported |

---

## Migration Note

Run the migration to add `report_json` to `campaign_health_reports`:
```sql
-- database/campaign_health_reports_report_json.sql
ALTER TABLE campaign_health_reports ADD COLUMN IF NOT EXISTS report_json JSONB;
```

---

## Health Evaluation Triggers (Unchanged)

Evaluation runs only in `campaignAiOrchestrator.ts`:
- After `saveStructuredCampaignPlan` (campaign saved, calendar regenerated, AI plan generated)
- After `saveStructuredCampaignPlanDayUpdate` (activity edited)

No evaluation from UI.
