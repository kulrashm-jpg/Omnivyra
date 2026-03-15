# Health System UI Integration Report

**Module:** Campaign Planner + Campaign Intelligence  
**Focus:** Health System UI Integration  
**Product:** Omnivyra  
**Date:** 2026-03-09

## Objective

Integrate Campaign Health diagnostics into the planner UI and activity workspace so users can see and fix issues directly while planning campaigns.

**Constraint:** Do NOT change health evaluation logic. Only consume existing `CampaignHealthReport` fields.

---

## FILES_MODIFIED

| File | Change Summary |
|------|----------------|
| `components/planner/CampaignHealthPanel.tsx` | Full render: Header (Score + Grade + Status), issue visibility, summary, warnings block, dimension display (score_breakdown table), publishes report to plannerSessionStore |
| `components/planner/PlannerCanvas.tsx` | Added PlanningCanvas (actual file: PlanningCanvas.tsx). Reads `health_report` from store; adds diagnostic badges on activity cards: Missing CTA (red), Missing Objective (orange), Missing Phase (yellow), Low Confidence Role (purple) |
| `components/planner/plannerSessionStore.ts` | Added `PlannerHealthReport`, `health_report`, `setHealthReport` |
| `pages/activity-workspace.tsx` | Fetches `/api/campaigns/[id]/intelligence-health` when campaignId present; displays Activity Diagnostics block when activity in `low_confidence_activities` or has missing metadata (CTA/Objective/Phase) |
| `pages/api/campaigns/[id]/intelligence-health.ts` | **New.** GET API: derives campaign_design + execution_plan from campaign + blueprint, calls `evaluateCampaignHealth`, returns full CampaignHealthReport for activity-workspace |
| `backend/jobs/campaignHealthEvaluationJob.ts` | Exported `evaluateAndPersistCampaignHealth(campaignId, companyId)` for single-campaign health evaluation + persist |
| `backend/services/campaignAiOrchestrator.ts` | Triggers `evaluateAndPersistCampaignHealth` after `saveStructuredCampaignPlan` (campaign saved, calendar regenerated, AI plan generated) and after `saveStructuredCampaignPlanDayUpdate` (activity edited) |

---

## HEALTH_PANEL_RENDER_TEST

| Field | Status |
|-------|--------|
| **health_score_display** | Header shows "Campaign Health: {score} ({status}) — Grade {grade}" |
| **summary_display** | `health_summary` rendered in Summary section |
| **issue_visibility** | "Showing top {visible_issue_count}" and "+{hidden_issue_count} additional issues not shown" when hidden > 0 |
| **warnings_block** | List under "Health Warnings" when `analysis_warnings.length > 0` |
| **dimension_display** | Score breakdown table: Narrative, Content Mix, Cadence, Audience Alignment, Execution Cadence, Platform Distribution, Role Balance, Metadata Completeness |

---

## ACTIVITY_DIAGNOSTIC_TEST

| Field | Status |
|-------|--------|
| **activity_id** | Uses `payload.activityId` or `dailyRaw.execution_id` |
| **diagnostics_rendered** | Activity Diagnostics block shows when: (1) activity in `low_confidence_activities`, or (2) missing CTA / Objective / Phase; displays Role, Confidence, Missing metadata list |

---

## PLANNER_OVERLAY_TEST

| Field | Status |
|-------|--------|
| **activity_badges** | Red (No CTA), Orange (No Objective), Yellow (No Phase), Purple (Low confidence) on activity cards in week/day views and list view |

---

## COMPILATION_STATUS

| Field | Status |
|-------|--------|
| **status** | Pending build completion |
| **errors** | None reported by linter on modified files |
| **warnings** | None reported |

---

## Implementation Notes

1. **CampaignHealthPanel** – Uses `usePlannerSession()` for `campaign_design` and `execution_plan`; POSTs to `/api/campaigns/health`; shares report via `setHealthReport` for PlanningCanvas badges.

2. **PlanningCanvas** – Reads `health_report` from store; low-confidence IDs from `role_distribution.low_confidence_activities`; missing metadata inferred from activity `cta`, `objective`, `phase` when present.

3. **Activity Workspace** – Fetches `GET /api/campaigns/[campaignId]/intelligence-health` (new API); derives design/plan from blueprint; returns full report including `low_confidence_activities`.

4. **Health Refresh** – `evaluateAndPersistCampaignHealth` runs fire-and-forget after plan save and day update in orchestrator; does not block response.
