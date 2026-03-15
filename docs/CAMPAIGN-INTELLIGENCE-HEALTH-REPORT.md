# Campaign Intelligence Layer — Campaign Health Analyzer Report

**Product:** Omnivyra  
**Module:** Campaign Intelligence Layer — Campaign Health Analyzer  
**Date:** 2025-03-08  

---

## FILES_CREATED

| file | purpose |
|------|---------|
| `pages/api/campaigns/health.ts` | POST API: accepts `campaign_design` + `execution_plan`, returns `CampaignHealthReport`. |
| `components/planner/CampaignHealthPanel.tsx` | UI panel: displays Narrative Balance, Content Mix, Cadence, Audience Alignment scores and suggestions list. |
| `backend/jobs/campaignHealthEvaluationJob.ts` | Daily job: evaluates active campaigns, derives design/plan from DB, stores suggestions via `campaign_health_reports`. |

---

## FILES_MODIFIED

| file | change_summary |
|------|----------------|
| `backend/services/campaignIntelligenceService.ts` | Added `evaluateNarrativeBalance`, `evaluateContentMix`, `evaluateCadence`, `evaluateAudienceAlignment`, `evaluateCampaignHealth`; types `CampaignDesignInput`, `ExecutionPlanInput`, `CampaignHealthReport`. |
| `pages/campaign-planner.tsx` | Imported `CampaignHealthPanel`; inserted panel above `PlanningCanvas`. |
| `components/planner/index.ts` | Exported `CampaignHealthPanel`. |
| `backend/scheduler/cron.ts` | Imported `runCampaignHealthEvaluation`; added daily run (24h) for campaign health evaluation. |

---

## HEALTH_EVALUATION_TEST

| item | value |
|------|-------|
| **input** | `campaign_design`: `{ idea_spine, campaign_brief, campaign_structure }`; `execution_plan`: `{ strategy_context, calendar_plan, activity_cards }` |
| **output** | `CampaignHealthReport`: `{ narrative_score, content_mix_score, cadence_score, audience_alignment_score, suggestions[] }` |

---

## COMPILATION_STATUS

| item | value |
|------|-------|
| **status** | OK |
| **errors** | None |
| **warnings** | None |

---

## CONSTRAINTS OBSERVED

- Planner state model not modified.
- No database schema changes; reuses `campaign_health_reports` for storage.
- Reused existing campaign data (campaigns, blueprint, `campaign_versions`) for job evaluation.
