# Influencer Intelligence Engine + Engagement Command Center Restructure — Report

**Date:** 2025-03-10  
**Scope:** Influencer detection; Engagement Command Center three-layer layout; ConversationMonitorHeader signals; ThreadList badges.

---

## FILES_CREATED

| File | Description |
|------|-------------|
| `database/influencer_intelligence.sql` | Table with author_id TEXT; indexes idx_influencer_org, idx_influencer_platform, idx_influencer_score |
| `backend/services/influencerIntelligenceService.ts` | calculateInfluencers, getTopInfluencers, getInfluencersByPlatform, computeInfluenceScore |
| `backend/workers/influencerLearningWorker.ts` | Runs every 30 min; aggregates authors, computes metrics, upserts |
| `pages/api/engagement/influencers.ts` | GET endpoint (organization_id, platform, limit) |
| `components/engagement/InfluencerPanel.tsx` | Top Influencers panel with platform icons, scores; View conversations + Open thread list filtered by author |

---

## FILES_MODIFIED

| File | Changes |
|------|---------|
| `components/engagement/AIEngagementAssistant.tsx` | Influencers to Engage section; onFilterByAuthor prop |
| `components/engagement/index.ts` | Exported InfluencerPanel |
| `backend/scheduler/cron.ts` | INFLUENCER_LEARNING_INTERVAL_MS = 30 min; runInfluencerLearningWorker |
| `components/engagement/InboxDashboard.tsx` | Layer 1–3 layout; 30/45/25 panels; authorFilter; trendingTopicsCount; onFilterByAuthor |
| `components/engagement/ConversationMonitorHeader.tsx` | 5 metrics: Active Conversations, High Priority Threads, Leads, Opportunity Signals, Trending Topics |
| `components/engagement/ThreadList.tsx` | authorFilter, onClearAuthorFilter; triage/classification/sentiment/lead/opportunity badges |
| `components/engagement/TrendingTopicsPanel.tsx` | onTopicsLoaded callback for header count |

---

## DATABASE_SCHEMA

```sql
influencer_intelligence (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT,
  platform TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  thread_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  recommendation_mentions INTEGER DEFAULT 0,
  question_answers INTEGER DEFAULT 0,
  engagement_score NUMERIC DEFAULT 0,
  influence_score NUMERIC NOT NULL DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  created_at, updated_at
)
```

**Indexes:** idx_influencer_org, idx_influencer_platform, idx_influencer_score (influence_score DESC), unique (organization_id, author_id, platform)

---

## INFLUENCE_SCORING_MODEL

**Weights:** message_count 0.25, thread_count 0.20, reply_count 0.20, recommendation_mentions 0.20, question_answers 0.15

**Formula:**
```
influence_score =
  0.25 * normalized(message_count) +
  0.20 * normalized(thread_count) +
  0.20 * normalized(reply_count) +
  0.20 * normalized(recommendation_mentions) +
  0.15 * normalized(question_answers)
```

- **normalized(x)**: min(1, x / max_per_org)
- **recommendation_mentions**: from engagement_opportunities (opportunity_type = 'recommendation_request')
- **question_answers**: from engagement_opportunities (opportunity_type = 'problem_discussion')

---

## WORKER_SCHEDULE

| Worker | Interval |
|--------|----------|
| influencerLearningWorker | 30 minutes |

**Process:**
1. Get organization_ids from engagement_threads
2. For each org: aggregate authors from engagement_messages (90-day lookback)
3. Compute message_count, thread_count, reply_count per (author, platform)
4. Count recommendation_mentions, question_answers from engagement_opportunities
5. Normalize and compute influence_score
6. Upsert influencer_intelligence

---

## API_ENDPOINT

**GET /api/engagement/influencers**

| Param | Type | Description |
|-------|------|-------------|
| organization_id | string | Required |
| platform | string | Optional filter |
| limit | number | Optional, default 10, max 100 |

**Response:**
```json
{
  "influencers": [
    {
      "author_name": "...",
      "platform": "...",
      "influence_score": 0.82,
      "message_count": 54,
      "recommendation_mentions": 8,
      "last_active_at": "..."
    }
  ]
}
```

---

## UI_PANEL

**InfluencerPanel** (in AI Engagement Assistant, after Network Expansion):

- **Fields:** author name, platform icon, influence score (%), message count, recommendation mentions, last active
- **Actions:** View conversations, Open thread list filtered by author (filters ThreadList by author_name + platform)
- **Platform icons:** LinkedIn, Twitter, YouTube, Reddit, Slack, Discord, GitHub, etc.

**Engagement Command Center Layout (3 layers):**
- **Layer 1 (Signals):** ConversationMonitorHeader — Active Conversations, High Priority Threads, Leads Detected, Opportunity Signals, Trending Topics
- **Layer 2 (Conversations):** ThreadList 30% | ConversationView 45% | AI Assistant 25%
- **Layer 3:** AI Assistant sections (Opportunity Signals, Potential Leads, Strategy, Replies, Content, Network Expansion, Insights, Content Opportunities, Influencers to Engage) — all collapsible

**ThreadList:** triage priority dot, classification badges, sentiment badge, lead indicator, opportunity indicator; Clear author filter when filtered

---

## COMPILATION_STATUS

- Linter: No errors reported
- Database: Run `database/influencer_intelligence.sql` before first run
- Existing pipelines: Unchanged (publishing, engagement reply, ingestion, opportunity detection, content opportunity engine)
