# Opportunity Forecasting + Auto Campaign Generator — Implementation Report

## Overview

Extends the opportunity radar so that high-confidence opportunities automatically produce campaign proposals. When strength exceeds 70, a proposal is auto-generated and the user can convert it to a full campaign.

---

## FILES CREATED

| File | Purpose |
|------|---------|
| `backend/services/opportunityForecastEngine.ts` | Evaluates opportunity strength (signal_count, confidence_score, engagement_score_avg, recency_factor) and returns recommended action |
| `backend/services/campaignProposalGenerator.ts` | Generates structured campaign plan drafts from high-strength opportunities |
| `database/campaign_proposals.sql` | Migration for `campaign_proposals` table |
| `pages/api/campaigns/proposals/index.ts` | GET /api/campaigns/proposals — list proposals with filters |
| `pages/api/campaigns/proposals/[id].ts` | GET /api/campaigns/proposals/[id] — full proposal detail |
| `pages/api/campaigns/proposals/convert.ts` | POST /api/campaigns/proposals/convert — convert proposal → campaign |
| `pages/api/campaigns/proposals/reject.ts` | POST /api/campaigns/proposals/reject — reject proposal |
| `pages/campaign-proposals.tsx` | Campaign proposals page (cards, View, Convert, Reject) |
| `docs/OPPORTUNITY-FORECASTING-IMPLEMENTATION-REPORT.md` | This report |

---

## FILES MODIFIED

| File | Changes |
|------|---------|
| `backend/jobs/engagementOpportunityScanner.ts` | After inserting opportunity: evaluate strength; if `campaign_recommended`, generate proposal and insert into `campaign_proposals`; added `proposals_created` to result |
| `pages/api/engagement/opportunity-radar.ts` | Added `campaign_proposal_available` to each item; when true, display "Campaign Recommended" as suggested_action |
| `components/planner/OpportunityInsightsTab.tsx` | Added `campaign_proposal_available` to type; when true, show Sparkles icon and "View Campaign Proposal" link → `/campaign-proposals?companyId=...` |
| `components/Header.tsx` | Added "Campaign Proposals" nav button linking to `/campaign-proposals` |

---

## DATABASE TABLES CREATED

### campaign_proposals

```sql
CREATE TABLE IF NOT EXISTS campaign_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  opportunity_id UUID NOT NULL,
  proposal_title TEXT NOT NULL,
  proposal_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposal_strength NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

-- Unique: one proposal per opportunity
CREATE UNIQUE INDEX idx_campaign_proposals_opportunity_id ON campaign_proposals(opportunity_id);
-- Indexes for org, status, created
```

---

## NEW SERVICES

### 1. opportunityForecastEngine.ts

- **`evaluateOpportunityStrength(opportunity)`**
  - Inputs: `signal_count`, `confidence_score`, `engagement_score_avg`, `recency_factor`
  - Formula: weighted sum → 0–100
    - signal_count × 0.35 (capped)
    - confidence_score × 0.35 (0–1)
    - engagement_score_avg × 0.2 (0–10 scale)
    - recency_factor × 0.1 (0–1)
  - Returns: `{ opportunity_strength, recommended_action }`
  - Actions: `monitor` (<40), `content_response` (40–70), `campaign_recommended` (>70)

### 2. campaignProposalGenerator.ts

- **`generateCampaignProposal(opportunity)`**
  - Output: `{ campaign_title, campaign_objective, recommended_duration_weeks, recommended_platforms, weekly_structure, topics_to_cover }`
  - Weekly structure: Awareness → Problem discussion → Solution introduction → Case study → Objection handling → Conversion CTA

---

## NEW APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/campaigns/proposals` | List proposals. Query: `organizationId`, `status` |
| GET | `/api/campaigns/proposals/[id]` | Full proposal detail |
| POST | `/api/campaigns/proposals/convert` | Convert proposal to campaign + twelve_week_plan. Body: `{ proposalId }` |
| POST | `/api/campaigns/proposals/reject` | Reject proposal. Body: `{ proposalId }` |

---

## UI COMPONENTS CREATED

### pages/campaign-proposals.tsx

- Proposal cards: title, strength, opportunity source, date
- Filters: draft, accepted, rejected, all
- Actions: View Proposal (modal), Convert to Campaign, Reject
- Empty state when no proposals

---

## OPPORTUNITY RADAR INTEGRATION

- Added `campaign_proposal_available` (boolean) to each item
- When proposal exists for opportunity: `suggested_action` = "Campaign Recommended"
- Used by `GET /api/engagement/opportunity-radar` (format=items, source=campaign_engagement)

---

## DATA FLOW DIAGRAM

```
campaign_activity_engagement_signals (last 24h)
        │
        ▼
engagementOpportunityEngine.scanSignalsForOpportunities()
        │
        ▼
DetectedOpportunity[] ───────────────────────────────────────────────┐
        │                                                             │
        ▼                                                             │
Insert into opportunity_radar                                         │
        │                                                             │
        ▼                                                             │
opportunityForecastEngine.evaluateOpportunityStrength()               │
        │                                                             │
        ├─ monitor ──────────────────────────────────────────────────┤
        │                                                             │
        ├─ content_response ─────────────────────────────────────────┤
        │                                                             │
        └─ campaign_recommended ─────────────────────────────────────┤
                        │                                             │
                        ▼                                             │
        campaignProposalGenerator.generateCampaignProposal()           │
                        │                                             │
                        ▼                                             │
        Insert into campaign_proposals (status=draft)                  │
                        │                                             │
                        └─────────────────────────────────────────────┘

USER FLOW:
──────────────────────────────────────────────────────────────────────
GET /api/engagement/opportunity-radar
  → items with campaign_proposal_available=true show "Campaign Recommended"

GET /api/campaigns/proposals
  → List proposals (draft/accepted/rejected)

GET /api/campaigns/proposals/[id]
  → Full proposal detail (title, objective, duration, platforms, weekly_structure, topics)

POST /api/campaigns/proposals/convert
  → 1. Fetch proposal
  → 2. Create campaign
  → 3. Create twelve_week_plan (blueprint)
  → 4. Create campaign_versions
  → 5. Update proposal status = accepted

POST /api/campaigns/proposals/reject
  → Update proposal status = rejected
```

---

## DEPLOYMENT CHECKLIST

1. Run database migration: `database/campaign_proposals.sql` in Supabase SQL Editor
2. Engagement opportunity scanner runs every 30 minutes (scheduler already configured); no config change needed
3. Nav link to campaign-proposals: Header includes "Campaign Proposals" button (after Home)

---

## TESTING

- **Forecast engine**: Call `evaluateOpportunityStrength` with various inputs; verify thresholds (<40, 40–70, >70)
- **Proposal generator**: Call `generateCampaignProposal` with mock opportunity; verify structure
- **Scanner**: Run `runEngagementOpportunityScanner()`; verify proposals created when strength >70
- **APIs**: GET proposals, GET detail, POST convert, POST reject
- **Page**: `/campaign-proposals` with company selected; verify cards, View, Convert, Reject
- **Opportunity radar**: GET with format=items; verify `campaign_proposal_available` and "Campaign Recommended" when proposal exists
