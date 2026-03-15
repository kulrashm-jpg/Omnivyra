# Implementation Report: Engagement → Opportunity Radar → Campaign Planner Intelligence Loop

## Overview

Transforms engagement signals into structured opportunities and campaign recommendations. Converts campaign activity engagement signals into actionable intelligence that feeds campaign planning.

---

## FILES CREATED

| File | Purpose |
|------|---------|
| `database/opportunity_radar.sql` | Migration: creates `opportunity_radar` table with unique index on (organization_id, opportunity_type, title) |
| `backend/services/engagementOpportunityEngine.ts` | Signal → opportunity detection: demand spikes, repeated questions, competitive mentions, emerging topics |
| `backend/jobs/engagementOpportunityScanner.ts` | Scheduled job: queries last 24h signals, runs engine, inserts into opportunity_radar |
| `backend/services/plannerOpportunityAdvisor.ts` | Generates campaign suggestions from opportunities |
| `pages/api/campaigns/planner/apply-opportunity.ts` | POST: applies opportunity to planner, updates opportunity_radar status |
| `pages/api/campaigns/planner/ignore-opportunity.ts` | POST: marks opportunity as ignored |
| `pages/api/admin/opportunity-engine-health.ts` | GET: observability for signals_processed, opportunities_detected, last_scan_time |
| `components/planner/OpportunityInsightsTab.tsx` | UI: displays opportunities with Apply / Ignore buttons |

---

## FILES MODIFIED

| File | Changes |
|------|---------|
| `backend/scheduler/cron.ts` | Added engagement opportunity scanner every 30 minutes |
| `backend/services/opportunityRadarService.ts` | Added `getOpportunityRadarItems()` and `OpportunityRadarItem` type |
| `pages/api/engagement/opportunity-radar.ts` | Extended with source, campaignId filters; returns items with suggested_action |
| `components/planner/StrategyAssistantPanel.tsx` | Added Opportunities tab, campaignId and onOpportunityApplied props |

---

## DATABASE CHANGES

**New table: `opportunity_radar`**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Required |
| opportunity_type | TEXT | buyer_intent, topic_trend, community_discussion, competitor_mention, product_question |
| source | TEXT | Default: campaign_engagement |
| title | TEXT | Required |
| description | TEXT | |
| confidence_score | NUMERIC | Required |
| signal_count | INTEGER | Required |
| engagement_score_avg | NUMERIC | |
| topic_keywords | TEXT[] | |
| related_campaign_id | UUID | |
| detected_at | TIMESTAMPTZ | |
| opportunity_score | NUMERIC | For ranking |
| status | TEXT | new, applied_to_campaign, ignored |
| applied_campaign_id | UUID | Set when applied |
| applied_at | TIMESTAMPTZ | Set when applied |

**Unique index:** `(organization_id, opportunity_type, title)` to avoid duplicates.

**Run migration:** Execute `database/opportunity_radar.sql` in Supabase SQL Editor.

---

## NEW JOBS

| Job | Schedule | Description |
|-----|----------|-------------|
| `runEngagementOpportunityScanner` | Every 30 minutes | Queries `campaign_activity_engagement_signals` (last 24h), runs detection engine, inserts into `opportunity_radar` |

---

## NEW SERVICES

| Service | Functions |
|---------|-----------|
| `engagementOpportunityEngine` | `scanSignalsForOpportunities`, `detectDemandSpikes`, `detectRepeatedQuestions`, `detectCompetitiveMentions`, `detectEmergingTopics` |
| `plannerOpportunityAdvisor` | `generateCampaignSuggestions(opportunity)` |

---

## NEW APIs

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/campaigns/planner/apply-opportunity` | POST | Apply opportunity to campaign planner (updates plan, sets status=applied_to_campaign) |
| `/api/campaigns/planner/ignore-opportunity` | POST | Mark opportunity as ignored |
| `/api/admin/opportunity-engine-health` | GET | Returns signals_processed_last_hour, opportunities_detected, processing_errors, last_scan_time |

---

## EXTENDED APIs

| Endpoint | New Query Params | New Response |
|----------|------------------|--------------|
| `GET /api/engagement/opportunity-radar` | source, campaignId, format | items[] with title, description, signal_count, confidence_score, topic_keywords, related_campaign_id, suggested_action |

---

## UI COMPONENTS UPDATED

| Component | Changes |
|-----------|---------|
| `StrategyAssistantPanel` | New "Opportunities" tab; receives campaignId, onOpportunityApplied |
| `OpportunityInsightsTab` (new) | Lists opportunities, Apply to Campaign and Ignore buttons |

---

## DATA FLOW DIAGRAM

```
campaign_activity_engagement_signals
         │
         │  every 30 min
         ▼
engagementOpportunityScanner
         │
         │  scanSignalsForOpportunities()
         ▼
engagementOpportunityEngine
    ├─ detectDemandSpikes (>10 same keyword in 24h)
    ├─ detectRepeatedQuestions (≥5 question intents)
    ├─ detectCompetitiveMentions (competitor patterns)
    └─ detectEmergingTopics (topic frequency growth)
         │
         │  INSERT (unique on org+type+title)
         ▼
opportunity_radar
         │
         │  GET /api/engagement/opportunity-radar?source=campaign_engagement
         ▼
OpportunityInsightsTab (StrategyAssistantPanel)
         │
         ├─ Apply → POST /api/campaigns/planner/apply-opportunity
         │              │
         │              ├─ plannerOpportunityAdvisor.generateCampaignSuggestions()
         │              ├─ Update opportunity_radar (status=applied, applied_campaign_id, applied_at)
         │              └─ Add topic to draft plan (topics_to_cover)
         │
         └─ Ignore → POST /api/campaigns/planner/ignore-opportunity
                        └─ Update opportunity_radar (status=ignored)
```

---

## OPPORTUNITY SCORING (PART 9)

```
opportunity_score = signal_count * 0.4 + engagement_score_avg * 0.3 + recency_factor * 0.3
```

Sorted by `opportunity_score DESC` when returning opportunities.

---

## TESTING

1. **Database:** Run `database/opportunity_radar.sql` in Supabase.
2. **Scanner:** Cron runs every 30 min; or invoke `runEngagementOpportunityScanner()` manually.
3. **API:** `GET /api/engagement/opportunity-radar?organization_id=<id>&source=campaign_engagement&format=items`
4. **Planner:** Add StrategyAssistantPanel with companyId and campaignId to a campaign planning view; open Opportunities tab.
5. **Admin health:** `GET /api/admin/opportunity-engine-health` (requires super-admin).
