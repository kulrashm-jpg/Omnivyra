# OPPORTUNITY RADAR — BACKEND READINESS AUDIT REPORT

**Scope:** Omnivyra Community Engagement backend readiness for implementing the Opportunity Radar layer in the Engagement Command Center header.

**Audit Date:** 2025-03-09

---

## 1. Signal Sources Status

### engagement_opportunities

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| organization_id | UUID | Required |
| platform | TEXT | Per-opportunity platform |
| source_thread_id | UUID | FK → engagement_threads |
| source_message_id | UUID | FK → engagement_messages |
| author_id | UUID | FK → engagement_authors, nullable |
| **opportunity_type** | TEXT | Classification field |
| opportunity_text | TEXT | Snippet |
| confidence_score | NUMERIC | 0–1 |
| priority_score | NUMERIC | |
| detected_at | TIMESTAMPTZ | |
| resolved | BOOLEAN | |
| resolved_at | TIMESTAMPTZ | |

**opportunity_type values (from engagementOpportunityService):**
- `question_request`
- `recommendation_request` ✓ (maps to Radar: recommendation requests)
- `competitor_complaint` ✓ (maps to Radar: competitor complaints)
- `problem_discussion`
- `product_comparison` ✓ (maps to Radar: product comparisons)

**Gap:** No explicit `competitor_mentions` or `complaint_signals` tables. `competitor_complaint` exists as an `opportunity_type` in `engagement_opportunities`.

### engagement_lead_signals

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| organization_id | UUID | FK → companies |
| message_id | UUID | FK → engagement_messages |
| thread_id | UUID | FK → engagement_threads |
| author_id | UUID | FK → engagement_authors, nullable |
| **lead_intent** | TEXT | Classification field |
| lead_score | INTEGER | 0–100 |
| confidence_score | NUMERIC | nullable |
| detected_at | TIMESTAMPTZ | |

**lead_intent values (from leadDetectionService):**
- `solution_exploration`, `tool_search`, `interest_expressed`
- `pricing_inquiry`, `demo_request`, `trial_interest` ✓ (buying intent)
- `usage_inquiry`, `connection_request`, `implementation_interest`
- `comparison_inquiry`, `lead_interest`

**Gap:** No `purchase_intent` column; buying intent is represented by `lead_intent` values such as `pricing_inquiry`, `demo_request`, `trial_interest`.

### conversation_triage / engagement_thread_classification

| Column | Type | Notes |
|--------|------|-------|
| organization_id | UUID | |
| thread_id | UUID | FK → engagement_threads |
| **classification_category** | TEXT | Same set as opportunity_type |
| classification_confidence | NUMERIC | |
| sentiment | TEXT | positive, negative, neutral, mixed |
| triage_priority | INTEGER | 1–10 |
| classified_at | TIMESTAMPTZ | |

**classification_category values:**  
`question_request`, `recommendation_request`, `competitor_complaint`, `problem_discussion`, `product_comparison`, `general_comment`

Classification is LLM-based and used for triage; it does not replace regex-based detection in `engagement_opportunities`.

### intelligence_signals

**Different domain.** Used for external API (news/trend) signals, not community engagement threads.

| Column | Type |
|--------|------|
| signal_type | TEXT |
| topic | TEXT |
| cluster_id | UUID |
| primary_category | TEXT |
| tags | JSONB |

Taxonomy: TREND, COMPETITOR, PRODUCT, CUSTOMER, MARKETING, etc.

### signal_clusters, signal_intelligence

**Different domain.** Consume `intelligence_signals` (news/trend pipeline). Not engagement conversation signals.

### engagement_signals

**Different domain.** Post-level metrics (likes, comments) from `community_posts`. Columns: `post_id`, `platform`, `engagement_type`, `engagement_count`, `captured_at`. Not used for conversation-level opportunity signals.

---

## 2. Detection Logic Status

### competitor_complaint

**Detector:** `engagementOpportunityService` (regex)

```ts
type: 'competitor_complaint'
patterns: [
  /\b(?:hate|terrible|awful|worst|disappointed|frustrated)\b.*\b(?:service|product|company)\b/i,
  /\b(?:service|product|company)\b.*\b(?:hate|terrible|awful|worst|disappointed)\b/i,
]
baseConfidence: 0.7
```

**Also:** `conversationTriageService` LLM prompt — categories include `competitor_complaint`.

### buying intent

**Detector:** `leadDetectionService` (regex)

Examples:

```ts
{ pattern: /\b(pricing|pricing model|how much|costs?)\b/i, intent: 'pricing_inquiry', score: 85 }
{ pattern: /\b(demo|schedule a demo|book a demo|see a demo)\b/i, intent: 'demo_request', score: 90 }
{ pattern: /\b(trial|free trial|try (?:it|your))\b/i, intent: 'trial_interest', score: 80 }
```

### recommendation_request

**Detector:** `engagementOpportunityService` (regex)

```ts
type: 'recommendation_request'
patterns: [
  /\brecommend\b/i, /\bbest tool\b/i, /\bwhat should I use\b/i,
  /\bsuggestions?\b/i, /\bany good\b/i,
  /\blooking for\b.*\b(?:tool|app|software)\b/i,
]
baseConfidence: 0.8
```

### product_comparison

**Detector:** `engagementOpportunityService` (regex)

```ts
type: 'product_comparison'
patterns: [
  /\bvs\.?\b/i, /\bversus\b/i, /\bbetter than\b/i,
  /\bcompare\b/i, /\b(?:or|and)\b.*\b(?:which one|which is better)\b/i,
]
baseConfidence: 0.7
```

**Also:** `leadDetectionService` — `comparison_inquiry` intent.

---

## 3. Aggregation Capability

### Current aggregation

| Service | Aggregation | Scope |
|---------|-------------|--------|
| `engagementAnalyticsService.getConversationCategoryDistribution` | Count by `classification_category` | All classified threads |
| `engagementAnalyticsService.getSentimentDistribution` | Count by `sentiment` | All classified threads |
| `engagementAnalyticsService.getLeadTrend` | Count by date (daily) | Leads in time window |
| `engagementAnalyticsService.getOpportunityTrend` | Count by date (daily) | Opportunities in time window |

### Gaps for Opportunity Radar

- **Counts by signal_type:** No aggregation by `opportunity_type` or `lead_intent`.
- **Counts by time window (e.g. 24h):** `getLeadTrend` / `getOpportunityTrend` use daily buckets, not configurable hours.
- **Counts by platform:** No aggregation by platform for opportunities or leads.
- **Counts by topic:** No topic-level aggregation; `classification_category` is the nearest proxy.

---

## 4. Thread Metadata Available

| Field | Source | Notes |
|-------|--------|------|
| thread_id | engagement_threads.id | ✓ |
| platform | engagement_threads.platform | ✓ |
| community / source | engagement_threads.source_id | Source ID, not a community label |
| author | engagement_authors (via messages) | ✓ |
| sentiment | engagement_thread_classification.sentiment | Per thread, after classification |
| detected_intents | engagement_thread_intelligence.dominant_intent; engagement_lead_signals.lead_intent | Partial (single dominant intent or per-message lead) |
| detected_entities | Not present | No entity extraction at thread level |
| topic | Not present | No topic column; classification_category is proxy |
| cluster_id | Not present | intelligence_signals only |

---

## 5. Storage Structure

### Tables

| Table | Exists | Key indexes |
|------|--------|-------------|
| engagement_threads | ✓ | platform_thread_id, source_id, organization_id, platform_thread_org (UNIQUE), priority, ignored |
| engagement_messages | ✓ | thread_id, platform_message_id, platform_created_at, platform, author_id |
| engagement_opportunities | ✓ | (organization_id, detected_at DESC), (priority_score), (source_thread_id), (organization_id, source_message_id) UNIQUE |
| engagement_lead_signals | ✓ | (thread_id), (organization_id), (lead_score), (message_id) UNIQUE |
| intelligence_signals | ✓ | (source_api_id, detected_at), (cluster_id), (topic), (company_id, detected_at) |
| signal_clusters | ✓ | (cluster_topic), (created_at) |
| signal_intelligence | ✓ | (cluster_id), (topic), (momentum_score), (created_at) |

### Index gaps for Opportunity Radar queries

| Query pattern | Support |
|---------------|---------|
| `COUNT(*) WHERE opportunity_type = X` | No index on `opportunity_type` |
| `COUNT(*) WHERE lead_intent = X` | No index on `lead_intent` |
| `GROUP BY detected_at` (24h windows) | `(organization_id, detected_at)` supports date-based filters |
| `GROUP BY platform` | No index on `platform` for opportunities/leads; platform is on opportunities, leads require thread join |
| `GROUP BY topic` | No topic column; classification_category exists but no aggregation index |

---

## 6. Processing Model

| Detection | Trigger | Timing |
|-----------|---------|--------|
| Lead detection | `engagementNormalizationService` → `processMessageForLeads` | During sync to engagement_messages (async) |
| Lead detection (alternate) | `engagementConversationIntelligenceService.analyzeMessage` | After message intelligence analysis |
| Opportunity detection | `engagementOpportunityDetectionWorker` (cron) | Batch: last 7 days, up to 100 messages per run |
| Classification (triage) | `conversationTriageService.classifyThread` | On-demand (LLM) |

**Summary:** Leads are processed during ingestion. Opportunities are processed in a batch worker; ingestion does not classify messages for opportunities.

---

## 7. Query Performance Readiness

| Query | Index support | Notes |
|-------|---------------|-------|
| `COUNT signals WHERE signal_type = X` | No | No index on `opportunity_type` or `lead_intent` |
| `GROUP BY last 24 hours` | Partial | `detected_at` in composite index; filter by time works, grouping by hour not indexed |
| `GROUP BY platform` | Partial | `platform` on engagement_opportunities; no index. Leads need join to threads |
| `GROUP BY topic` | No | No topic; classification_category available but no aggregation index |

---

## 8. API Layer Status

### Existing engagement APIs

| Endpoint | Purpose | Opportunity Radar suitability |
|----------|---------|------------------------------|
| GET /api/engagement/opportunities | Opportunities for a specific thread | No — requires `thread_id`; per-thread only |
| GET /api/engagement/leads | Leads for organization | No — returns individual leads, not aggregated counts |
| GET /api/engagement/analytics | Dashboard analytics | Partial — trends by date only; no counts by signal type |
| GET /api/engagement/inbox | Inbox threads | No — thread list, not signal counts |
| GET /api/engagement/platform-counts | Thread counts by platform | No — thread counts, not opportunity/lead counts |

### Gap

There is no API that returns global aggregated counts for:

- `competitor_complaint`
- `buying_intent` (pricing_inquiry, demo_request, trial_interest, etc.)
- `recommendation_request`
- `product_comparison`

Nor are there parameters for time window (e.g. last 24h), platform, or topic.

---

## 9. Missing Components For Opportunity Radar

1. **Global aggregation API**
   - Endpoint returning cross-thread counts by signal type (opportunity_type + lead_intent buckets).
   - Optional filters: time window (e.g. 24h), platform, topic/classification_category.

2. **Counts by signal type**
   - Logic to count:
     - Opportunities by `opportunity_type` (competitor_complaint, recommendation_request, product_comparison).
     - Leads by `lead_intent` for buying intent (pricing_inquiry, demo_request, trial_interest).

3. **Query performance**
   - Indexes on `engagement_opportunities(opportunity_type)` and `(platform)` (or composite).
   - Index on `engagement_lead_signals(lead_intent)` and `(detected_at)`.
   - Consider platform via `engagement_opportunities.platform` or join to `engagement_threads` for leads.

4. **Time-window support**
   - Configurable window (e.g. 24h) for counts, instead of fixed daily aggregation.

5. **Unified signal model (optional)**
   - No single table today that unifies opportunity types and lead intents for cross-thread counts. Either:
     - Query `engagement_opportunities` and `engagement_lead_signals` separately and merge, or
     - Introduce a materialized/denormalized layer for Opportunity Radar.

---

## 10. Implementation Complexity Assessment

| Component | Complexity | Notes |
|-----------|------------|-------|
| Signal sources | Low | `engagement_opportunities` and `engagement_lead_signals` already have needed types |
| Detection logic | None | Detection exists; no changes required for Radar |
| Aggregation logic | Medium | New service/API to aggregate by type, platform, time |
| Indexes | Low | Add indexes on opportunity_type, lead_intent, platform, detected_at |
| API | Medium | New endpoint or extend analytics with Radar parameters |
| UI integration | Not in scope | Backend audit only |

**Overall:** Moderate. Data and detection are in place; main work is aggregation, indexing, and API design for global cross-thread counts.
