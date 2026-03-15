# Audit Report: Engagement → Opportunity Radar → Campaign Planner Pipeline Verification

**Audit Date:** 2025-03-12  
**Objective:** Verify the full intelligence loop from engagement signals to campaign planner suggestions operates without gaps.

---

## DATABASE STATUS — ✅ PASS

**Table:** `opportunity_radar` (defined in `database/opportunity_radar.sql`)

| Field | Present | Notes |
|-------|---------|-------|
| id | ✅ | UUID PRIMARY KEY |
| organization_id | ✅ | UUID NOT NULL |
| opportunity_type | ✅ | CHECK constraint: buyer_intent, topic_trend, community_discussion, competitor_mention, product_question |
| source | ✅ | TEXT, default 'campaign_engagement' |
| title | ✅ | TEXT NOT NULL |
| description | ✅ | TEXT |
| confidence_score | ✅ | NUMERIC NOT NULL |
| signal_count | ✅ | INTEGER NOT NULL |
| detected_at | ✅ | TIMESTAMPTZ NOT NULL |
| related_campaign_id | ✅ | UUID |
| topic_keywords | ✅ | TEXT[] |
| status | ✅ | 'new', 'applied_to_campaign', 'ignored' |
| applied_campaign_id | ✅ | UUID |
| applied_at | ✅ | TIMESTAMPTZ |

**Unique index:** `idx_opportunity_radar_org_type_title` on `(organization_id, opportunity_type, title)` with `WHERE title IS NOT NULL AND title != ''`.

**Action:** Run `database/opportunity_radar.sql` in Supabase SQL Editor if the table does not exist.

---

## SIGNAL PIPELINE STATUS — ✅ PASS

**Source table:** `campaign_activity_engagement_signals`  
**Query:** `detected_at >= windowStart` where `windowStart = now() - 24 hours`  
(equivalent to `detected_at > now() - interval '24 hours'`)

**Signal fields used by the opportunity engine:**

| Field | Used By |
|-------|---------|
| id | All detectors (signal_ids) |
| campaign_id | Org resolution, related_campaign_id |
| activity_id | Pass-through to input |
| platform | Pass-through to input |
| content | detectDemandSpikes, detectRepeatedQuestions, detectCompetitiveMentions, detectEmergingTopics |
| signal_type | Pass-through |
| engagement_score | All detectors (confidence, avg) |
| detected_at | Pass-through |
| organization_id | Org resolution (fallback to campaign→company_id) |

---

## OPPORTUNITY ENGINE STATUS — ✅ PASS

**Service:** `backend/services/engagementOpportunityEngine.ts`

| Function | Exists | Returns title, description, signal_count, confidence_score, topic_keywords |
|----------|--------|------------------------------------------------------------------------------|
| scanSignalsForOpportunities | ✅ | Aggregates all detectors |
| detectDemandSpikes | ✅ | ✅ (>10 same keyword in 24h) |
| detectRepeatedQuestions | ✅ | ✅ (≥5 question intents) |
| detectCompetitiveMentions | ✅ | ✅ (≥2 competitive signals) |
| detectEmergingTopics | ✅ | ✅ (≥5 signals per topic) |

All detectors return `DetectedOpportunity` with the required fields.

---

## OPPORTUNITY SCANNER JOB STATUS — ✅ PASS

**Job:** `backend/jobs/engagementOpportunityScanner.ts`  
**Cron schedule:** Every 30 minutes (`ENGAGEMENT_OPPORTUNITY_SCANNER_INTERVAL_MS = 30 * 60 * 1000`)

**Process:**
1. ✅ Query signals: `campaign_activity_engagement_signals` where `detected_at >= windowStart`
2. ✅ Run detection engine: `scanSignalsForOpportunities(inputSignals)`
3. ✅ Insert opportunities: `supabase.from('opportunity_radar').insert(row)` per opportunity

**Deduplication:** Unique index `(organization_id, opportunity_type, title)`; insert error `23505` (unique violation) causes the row to be skipped and processing continues.

---

## OPPORTUNITY RADAR API STATUS — ⚠️ PARTIAL

**API:** `GET /api/engagement/opportunity-radar`  
**Handler:** `pages/api/engagement/opportunity-radar.ts`

| Filter | Supported | Notes |
|--------|-----------|-------|
| organization_id | ✅ | Required (or organizationId) |
| campaignId | ✅ | Passed to getOpportunityRadarItems |
| source | ✅ | Passed to getOpportunityRadarItems |
| opportunity_type | ❌ | Not passed to service; `getOpportunityRadarItems` does not filter by opportunity_type |
| format | ✅ | items \| stats |

**Response fields:** ✅  
- title, description, signal_count, confidence_score, topic_keywords, related_campaign_id  
- suggested_action (from planner advisor)

**Gap:** ~~API does not support `opportunity_type` query filter.~~ Fixed: `opportunity_type` filter added.

---

## PLANNER ADVISOR STATUS — ⚠️ NAMING VARIANCE

**Service:** `backend/services/plannerOpportunityAdvisor.ts`  
**Function:** `generateCampaignSuggestions(opportunity)` — ✅ exists

**Output shape:** `CampaignSuggestion` (not exact audit spec):

| Audit field | Implemented field | Notes |
|-------------|-------------------|-------|
| suggestion_text | action | Same meaning, different name |
| recommended_week | week_hint | Same meaning |
| recommended_activity | topic | Topic/focus; not full activity object |

**Example output:**
```json
{
  "action": "Create a campaign addressing pricing signals. 12 engagement signals indicate buyer interest.",
  "week_hint": 4,
  "topic": "pricing",
  "priority": "high"
}
```

Functionally equivalent to the audit spec; naming differs.

---

## PLANNER UI STATUS — ⚠️ BUG

**Component:** `components/planner/StrategyAssistantPanel.tsx`

| Item | Status | Notes |
|------|--------|-------|
| Tab label | ✅ | "Opportunities" |
| Display: title | ✅ | via OpportunityInsightsTab |
| Display: signal_count | ✅ | "X signals" |
| Display: confidence_score | ✅ | "X% confidence" |
| Button: Apply to Campaign | ✅ | Shown when campaignId present |
| Button: Ignore | ✅ | Always shown |

**Bug:** ~~`campaignId` and `onOpportunityApplied` are defined in `StrategyAssistantPanelProps` but **not destructured** in the component.~~ Fixed: Both props are now destructured and passed to OpportunityInsightsTab.

---

## APPLY/IGNORE WORKFLOW STATUS — ✅ PASS

### Apply opportunity

**API:** `POST /api/campaigns/planner/apply-opportunity`  
**Input:** `campaignId`, `opportunityId`

**Steps verified:**
1. ✅ Fetch opportunity from `opportunity_radar`
2. ✅ Generate planner update via `generateCampaignSuggestions`
3. ✅ Update `opportunity_radar`: `status = 'applied_to_campaign'`, `applied_campaign_id`, `applied_at`
4. ✅ Update planner structure: `getLatestDraftPlan` → add topic to `topics_to_cover` → `saveDraftBlueprint`

**Planner persistence:** `twelve_week_plan` via `saveDraftBlueprint` (draft blueprint in DB).

### Ignore opportunity

**API:** `POST /api/campaigns/planner/ignore-opportunity`  
**Verified:** ✅ Updates `opportunity_radar.status = 'ignored'`

---

## OBSERVABILITY STATUS — ⚠️ PARTIAL

**API:** `GET /api/admin/opportunity-engine-health`  
**Auth:** Super-admin required via `checkSuperAdmin`

| Metric | Returned | Notes |
|--------|----------|-------|
| signals_processed_last_hour | ✅ | Count of signals with detected_at in last hour |
| opportunities_detected | ✅ | Count of opportunities detected_at in last hour |
| processing_errors | ✅ | Always `[]` — no persistent error store from scanner runs |
| last_scan_time | ✅ | Latest `detected_at` among opportunities in last hour |

**Gap:** ~~`processing_errors` does not reflect actual scanner errors~~ Fixed: Scanner persists errors to `opportunity_engine_errors`; health endpoint returns them.

---

## ANY MISSING LINKS

1. **StrategyAssistantPanel props:** `campaignId` and `onOpportunityApplied` are not destructured, so they are always undefined. Apply button never shows and Apply flow cannot be triggered from the Opportunities tab.
2. **opportunity_type API filter:** `GET /api/engagement/opportunity-radar` does not support filtering by `opportunity_type`.
3. **StrategyAssistantPanel usage:** Grep shows no page currently renders `StrategyAssistantPanel` with `companyId`/`campaignId`. The Opportunities tab will not appear in the live UI until the panel is mounted on a campaign-planning page (e.g. campaign-planning or campaign-calendar).

---

## SUMMARY

| Area | Status |
|------|--------|
| Database | ✅ Pass |
| Signal pipeline | ✅ Pass |
| Opportunity engine | ✅ Pass |
| Scanner job | ✅ Pass |
| Opportunity Radar API | ⚠️ Partial (opportunity_type filter missing) |
| Planner advisor | ✅ Pass (naming variance only) |
| Planner UI | ⚠️ Bug (props not destructured) |
| Apply/Ignore workflow | ✅ Pass |
| Observability | ⚠️ Partial (processing_errors not real-time) |

**Recommended fix:** Add `campaignId` and `onOpportunityApplied` to the destructured props in `StrategyAssistantPanel.tsx` so the Apply flow works when the panel is used.
