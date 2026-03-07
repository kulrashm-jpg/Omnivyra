# Growth Intelligence — Phase-1 Read-Only Integration Report

This report identifies exactly where the Growth Intelligence module can safely derive signals using **existing data structures** without any schema changes, new tables, or new write paths.

**Phase-1 Constraints (STRICT):**
- MUST NOT modify existing tables
- MUST NOT introduce new database tables
- MUST NOT introduce new write paths into workers or API routes
- MUST only read existing system data

---

## SECTION 1 — Campaign Execution Data Sources

### Tables and Schema Summary

| Table | Primary Key | Company/Tenant Column | campaign_id | Important Metrics Fields |
|-------|-------------|------------------------|-------------|---------------------------|
| **campaigns** | `id` UUID | None (use `user_id` → `user_company_roles` → `company_id`) | — | `status`, `start_date`, `end_date`, `user_id`, `virality_playbook_id` |
| **weekly_content_refinements** | `id` UUID | None | `campaign_id` FK | `campaign_id`, `week_number`, `theme`, `focus_area`, `refinement_status`, `finalized`, `daily_plan_populated` |
| **daily_content_plans** | `id` UUID | None | `campaign_id` FK | `campaign_id`, `week_number`, `date`, `platform`, `content_type`, `status`, `scheduled_time` |
| **platform_execution_plans** | (id) | `company_id` TEXT | (in snapshot) | `company_id`, execution plans per platform |
| **scheduled_posts** | `id` UUID | None (via `user_id`) | `campaign_id` FK | `campaign_id`, `status`, `scheduled_for`, `published_at`, `platform_post_id`, `platform`, `content_type` |
| **queue_jobs** | `id` UUID | None | Via `scheduled_post_id` → `scheduled_posts.campaign_id` | `scheduled_post_id`, `status`, `job_type` |
| **campaign_readiness** | `campaign_id` PK | None | `campaign_id` | `readiness_percentage`, `readiness_state`, `last_evaluated_at` |
| **campaign_virality_assessments** | `id` UUID | None | `campaign_id` | `campaign_id`, `snapshot_hash`, `diagnostics`, `model_version` |
| **campaign_versions** | `id` UUID | `company_id` TEXT | `campaign_id` | `company_id`, `campaign_id`, `campaign_snapshot`, `status` |

### Flow: Planning → Scheduling → Publishing

1. **Planning**
   - `campaigns` — campaign metadata, status
   - `weekly_content_refinements` — week-level plans per campaign
   - `daily_content_plans` — day-level execution items (status: planned → content-created → media-ready → scheduled → published)

2. **Readiness**
   - `campaign_readiness` — readiness_state: `not_ready` | `partial` | `ready`
   - `campaign_virality_assessments` — virality diagnostics cache

3. **Scheduling**
   - Plans → `scheduled_posts` (status: draft | scheduled | publishing | published | failed | cancelled)
   - `scheduled_posts` has `scheduled_for`, `platform`, `content_type`, `campaign_id`

4. **Publishing**
   - Cron (every 60s) finds due `scheduled_posts` where `status = 'scheduled'` and `scheduled_for <= NOW()`
   - Creates `queue_jobs` row, enqueues BullMQ publish job
   - Worker processes job → updates `scheduled_posts` with `platform_post_id`, `status = 'published'`, `published_at`

---

## SECTION 2 — Publishing & Execution Workers

### Pipeline Location

| Component | Path | Purpose |
|-----------|------|---------|
| Queue client | `backend/queue/bullmqClient.ts` | BullMQ connection |
| Publish processor | `backend/queue/jobProcessors/publishProcessor.ts` | Processes publish jobs |
| Publish now (immediate) | `backend/services/publishNowService.ts` | Super-admin immediate publish |
| Scheduler | `backend/scheduler/schedulerService.ts` | `findDuePostsAndEnqueue()` |
| Cron | `backend/scheduler/cron.ts` | Triggers scheduler every 60s |

### Flow: scheduled_posts → Publish Queue

1. **Enqueue**: `findDuePostsAndEnqueue()` queries `scheduled_posts` where `status = 'scheduled'`, `scheduled_for <= now`, campaign active and ready → creates `queue_jobs` row → adds job to BullMQ `publish` queue.
2. **Process**: `processPublishJob()` loads job, validates idempotency (`queue_jobs.status === 'completed'` or `scheduled_posts.platform_post_id` exists), calls `publishToPlatform()`, then updates DB.

### Publish Success/Failure Recording

- **Success**: `updateScheduledPostOnPublish()` sets `platform_post_id`, `post_url`, `published_at`, `status = 'published'`.
- **Failure**: `updateScheduledPostOnFailure()` sets `status = 'failed'`, `error_message`; `updateQueueJobStatus('failed', ...)`.
- **platform_post_id**: Stored in `scheduled_posts.platform_post_id` on success.

### Analytics Ingestion Trigger

- Called in `publishProcessor` after successful publish (lines 154–169):
  ```ts
  await recordPostAnalytics(scheduled_post_id, user_id, platform, { views, likes, shares, comments }, {})
  ```
- `recordPostAnalytics` writes to `content_analytics` and updates `platform_performance`.

### Publishing Status from Existing Fields

**YES.** Publishing status can be inferred from:

- `scheduled_posts.status`: `draft`, `scheduled`, `publishing`, `published`, `failed`, `cancelled`
- `scheduled_posts.platform_post_id`: non-null ⇒ published
- `scheduled_posts.published_at`: timestamp of publish
- `queue_jobs.status`: `pending`, `processing`, `completed`, `failed` (per `scheduled_post_id`)

---

## SECTION 3 — Analytics & Engagement Sources

### Tables

| Table | Primary Key | Scoping | Metrics |
|-------|-------------|---------|---------|
| **content_analytics** | `id` | `scheduled_post_id`, `user_id`, `analytics_date` | `views`, `likes`, `shares`, `comments`, `saves`, `retweets`, `quotes`, `reactions`, `engagement_rate`, `reach`, `impressions` |
| **platform_performance** | (id) | `user_id`, `platform`, `date` | `total_posts`, `total_views`, `total_likes`, `total_shares`, `total_comments`, `avg_engagement_rate`, `best_post_id`, `best_post_engagement` |
| **content_performance_metrics** | (id) | `content_asset_id`, `campaign_id`, `platform` | `metrics_json`, `captured_at` |
| **post_comments** | `id` | `scheduled_post_id`, `platform` | `content`, `like_count`, `reply_count`, `platform_comment_id`, `created_at` |
| **comment_replies** | `id` | `comment_id`, `user_id` | `content`, `status`, `sent_at` |

### Data Flow

1. **recordPostAnalytics** (analyticsService): called by publish processor → upserts `content_analytics`, updates `platform_performance`.
2. **performance/ingest** API: `ingestPerformanceData()` → upserts `content_performance_metrics` (keyed by `content_asset_id`, `platform`, `captured_at`).
3. **Engagement polling worker**: `ingestComments()` in `engagementIngestionService` → inserts into `post_comments` for published posts with `platform_post_id`.
4. **comment_replies**: user-generated replies; linked via `comment_id` → `post_comments` → `scheduled_post_id`.

### Engagement Metrics Available (Read-Only)

- Post-level: `content_analytics` (views, likes, shares, comments, engagement_rate)
- Platform-level: `platform_performance` (totals, best post)
- Comment counts: `post_comments` (per `scheduled_post_id`), `like_count`, `reply_count` on each comment
- Reply counts: `comment_replies` (per `comment_id`)

---

## SECTION 4 — Community AI Action Data

### Tables

| Table | Primary Key | Scoping | Action Fields |
|-------|-------------|---------|---------------|
| **community_ai_actions** | `id` | `tenant_id`, `organization_id` | `platform`, `action_type`, `target_id`, `status`, `created_at`, `updated_at`, `execution_result`, `scheduled_at` |
| **community_ai_action_logs** | `id` | `tenant_id`, `organization_id` | `action_id`, `event_type`, `event_payload`, `created_at` |

- **Status**: `pending`, `approved`, `executed`, `failed`, `skipped`
- **Action types**: `like`, `reply`, `share`, `follow`, `schedule`
- **target_id**: Platform post ID or URL (not FK to scheduled_posts)
- **organization_id** ≈ `company_id` for scoping

### Relation to Campaigns and Posts

- No direct `campaign_id` on `community_ai_actions`.
- **Indirect link**: `target_id` can match `scheduled_posts.platform_post_id` → `scheduled_posts.campaign_id`.
- For Growth Intelligence: count executed actions by `organization_id` (optionally join `target_id` to `scheduled_posts.platform_post_id` for campaign-level attribution).

---

## SECTION 5 — Intelligence Pipeline Outputs

### Tables

| Table | Primary Key | Scoping | Purpose |
|-------|-------------|---------|---------|
| **intelligence_signals** | `id` | `company_id` (nullable), `source_api_id` | Raw signals from external APIs |
| **signal_clusters** | `cluster_id` | — | Grouped signals by topic |
| **signal_intelligence** | `id` | — | Clustered intelligence records |
| **strategic_themes** | `id` | — | Themes from clusters (title, description, momentum_score) |
| **campaign_opportunities** | `id` | — | Opportunities from themes (title, type, momentum_score) |
| **theme_company_relevance** | `id` | `company_id`, `theme_id` | Relevance of themes to companies |

### Signal Generation Flow

1. Intelligence polling worker → `externalApiService.fetchSingleSourceForIntelligencePolling()` → `intelligenceSignalStore.insertFromTrendApiResults()` → `intelligence_signals`.
2. Scheduler: `runSignalClustering()` → `signal_clusters`.
3. `runSignalIntelligenceEngine()` → `signal_intelligence`.
4. `runStrategicThemeEngine()` → `strategic_themes`.
5. `runCampaignOpportunityEngine()` → `campaign_opportunities`.
6. `runCompanyTrendRelevance()` → `theme_company_relevance`.

### Campaign Creation from Opportunities

- API: `POST /api/campaigns/create-from-opportunity` with `opportunity_id`, `company_id`.
- Service: `opportunityCampaignGenerator.generateCampaignFromOpportunity()`:
  - Inserts `campaigns` row.
  - Inserts `campaign_versions` with `metadata.source = 'trend_opportunity'`, `metadata.opportunity_id`, `planning_context.source_opportunity_id`.

**Recording:** Opportunity→campaign conversion is stored in `campaign_versions.campaign_snapshot.metadata.opportunity_id` and `planning_context.source_opportunity_id`. No separate conversion table.

**Read-only derivation:** Join `campaign_versions` where `campaign_snapshot->>'metadata'->>'source' = 'trend_opportunity'` to get campaigns created from opportunities.

---

## SECTION 6 — Recommendation Engine

### Tables

| Table | Primary Key | Scoping | Purpose |
|-------|-------------|---------|---------|
| **recommendation_jobs** / **recommendation_jobs_v2** | `id` | `company_id` | Job status, `consolidated_result` |
| **recommendation_policies** | (id) | — | Policy config |
| **recommendation_snapshots** | (id) | `company_id` | Snapshot of recommendations |
| **recommendation_audit_logs** | (id) | `company_id` | Audit log |

### Pipeline

- Recommendation jobs run per company.
- Results stored in `consolidated_result` and snapshots.
- Create-campaign: `POST /api/recommendations/create-campaign-from-group` creates campaigns from recommendation groups.

### Campaign Creation and Acceptance

- `create-campaign-from-group` creates campaigns; no dedicated “conversion” table.
- Recommendation acceptance: inferred from job/snapshot state or from campaigns created via that flow (no explicit acceptance flag in schema).

---

## SECTION 7 — Existing Executive & Analytics APIs

### /api/executive/campaign-health

- **Method**: GET
- **Query**: `campaignId`
- **Auth**: `requireCampaignAccess`
- **Response** (CampaignHealthSummary):
  - `engagement_trend_percent`, `reach_trend_percent`
  - `total_engagement_last_7_days`, `total_comments_last_7_days`
  - `stability_level`, `volatility_score`
  - `strategist_acceptance_rate`, `auto_distribution_ratio`
  - `performance_health`, `alerts`
  - `ai_spend_last_30_days`, `ai_budget`
- **Data sources**: `campaign_performance_metrics`, `campaign_performance`, `scheduled_posts`, `post_comments`, `campaign_distribution_decisions`, `campaign_strategic_memory`, `usage_events`, `campaigns`

### /api/analytics/campaign-roi

- **Method**: GET
- **Query**: `campaignId`
- **Auth**: withRBAC (COMPANY_ADMIN+)
- **Response**: CampaignRoiIntelligence (roiScore, performanceScore, governanceStabilityScore, executionReliabilityScore, optimizationSignal)
- **Source**: `CampaignRoiIntelligenceService` → `campaign_performance_metrics`, `GovernanceAnalyticsService`

### /api/analytics/company-roi

- **Method**: GET
- **Query**: `companyId`
- **Auth**: withRBAC
- **Response**: `{ companyId, averageRoiScore, highRiskCampaignsCount, highPotentialCampaignsCount, totalCampaigns }`
- **Source**: `GovernanceAnalyticsService`

### /api/analytics/report (POST)

- **Body**: `companyId`, `campaignId?`, `timeframe?`
- **Response**: `computeAnalytics()` → `engagementRate`, `bestPlatforms`, `bestContentTypes`, `trendSuccess`, `topAssets`, `underperformingAssets`
- **Source**: `analyticsService` → `listPerformanceMetrics` (`content_performance_metrics`)

### /api/performance/*

- **collect**, **ingest**: Write performance data.
- **campaign/[id]**: Campaign performance (read).

### Appending a Growth Score

**YES.** Growth Intelligence can compute a score from read-only queries and return it alongside existing responses. No schema change. Options:

- Add to response payload (e.g. `growth_score` field).
- Or expose via a separate endpoint that consumes the same underlying read services.

---

## SECTION 8 — Company & Campaign Scoping

### Tables

| Table | Purpose |
|-------|---------|
| **companies** | `id` UUID, `name`, `website`, `industry`, `status` |
| **user_company_roles** | `user_id`, `company_id`, `role`, `status` |

### Identifier Usage

| Identifier | Use |
|------------|-----|
| **company_id** | Primary tenant scope. Used in: `campaign_versions`, `theme_company_relevance`, `recommendation_jobs_v2`, `company_api_configs`, `campaign_governance_events`, `platform_metrics_snapshots`, etc. |
| **organization_id** | Community AI; typically equals `company_id` for tenant scope. |
| **tenant_id** | Community AI; multi-tenant identity. |

### Campaign → Company Resolution

- `campaigns` has `user_id` only (no `company_id`).
- Resolution path: `campaigns.user_id` → `user_company_roles` (status = 'active') → `company_id`.
- Or: `campaign_versions.company_id` where `campaign_versions.campaign_id = campaigns.id` (preferred when versions exist).

### Recommendation for Growth Intelligence

**Use `company_id` consistently.** Resolve via:

- `campaign_versions.company_id` when a version exists.
- Or `user_company_roles.company_id` from `campaigns.user_id` (primary active role).

---

## SECTION 9 — Read-Only Growth Intelligence Opportunities

All metrics below are derivable from existing tables with **SELECT only**. No new tables or writes.

### Content Velocity

| Metric | Source | Query |
|--------|--------|-------|
| Posts scheduled per campaign | `scheduled_posts` | `COUNT(*) WHERE campaign_id = ? AND status IN ('scheduled','published')` |
| Posts planned per week | `daily_content_plans` | `COUNT(*) WHERE campaign_id = ? AND week_number = ?` |
| Weekly refinement count | `weekly_content_refinements` | `COUNT(*) WHERE campaign_id = ?` |

### Publishing Success Rate

| Metric | Source | Query |
|--------|--------|-------|
| Published count | `scheduled_posts` | `COUNT(*) WHERE campaign_id = ? AND status = 'published'` |
| Failed count | `scheduled_posts` | `COUNT(*) WHERE campaign_id = ? AND status = 'failed'` |
| Success rate | Derived | `published / (published + failed)` |
| Posts with platform_post_id | `scheduled_posts` | `COUNT(*) WHERE campaign_id = ? AND platform_post_id IS NOT NULL` |

### Engagement Score

| Metric | Source | Query |
|--------|--------|-------|
| Post engagement | `content_analytics` | Join `scheduled_posts` on `scheduled_post_id` WHERE `campaign_id`; SUM views, likes, shares, comments |
| Platform totals | `platform_performance` | By `user_id` (from campaign) + platform + date range |
| Comment count per post | `post_comments` | `COUNT(*) WHERE scheduled_post_id IN (SELECT id FROM scheduled_posts WHERE campaign_id = ?)` |
| Reply count | `comment_replies` | Via `post_comments.comment_id` |

### Community Engagement

| Metric | Source | Query |
|--------|--------|-------|
| Executed actions count | `community_ai_actions` | `COUNT(*) WHERE organization_id = ? AND status = 'executed'` |
| Actions by type | `community_ai_actions` | Group by `action_type`, `status = 'executed'` |
| Action logs | `community_ai_action_logs` | `event_type = 'executed'` |

### Opportunity Activation

| Metric | Source | Query |
|--------|--------|-------|
| Campaigns from opportunities | `campaign_versions` | `campaign_snapshot->'metadata'->>'source' = 'trend_opportunity'` |
| Opportunity ID per campaign | `campaign_versions` | `campaign_snapshot->'metadata'->>'opportunity_id'` |
| Themes relevant to company | `theme_company_relevance` | By `company_id` |
| Opportunities available | `campaign_opportunities` + `theme_company_relevance` | Join themes to company relevance |

### Readiness & Virality

| Metric | Source | Query |
|--------|--------|-------|
| Readiness state | `campaign_readiness` | `readiness_state`, `readiness_percentage` per campaign |
| Virality assessments | `campaign_virality_assessments` | Count per campaign |

### Queue Health

| Metric | Source | Query |
|--------|--------|-------|
| Pending/processing jobs | `queue_jobs` | By `scheduled_post_id` → campaign |
| Failed jobs | `queue_jobs` | `status = 'failed'` |

### Executive-Style Aggregates

| Metric | Derivation |
|--------|------------|
| Content velocity trend | Scheduled posts per week over time |
| Publishing cadence | Days between publishes |
| Engagement trend | Week-over-week change from `content_analytics` + `post_comments` |
| Opportunity conversion rate | Campaigns from opportunities / opportunities surfaced (if that count is available) |

---

## SECTION 10 — Safe Integration Points

### 1. New Service Module: `backend/services/growthIntelligence/`

**Rationale**: Pure read-only services. No access to queues, workers, or write paths. Imports existing `supabase` client and runs SELECTs only. Does not modify existing services.

**Safe because**: Additive only; no changes to `publishProcessor`, `schedulerService`, or any worker.

### 2. Shared Library: `lib/intelligence/`

**Rationale**: `lib/intelligence` already has read-only helpers (e.g. `distributionStability`, `strategicMemory`). Growth Intelligence can add pure functions (e.g. scoring, aggregation) that take data and return derived metrics.

**Safe because**: No DB access; stateless functions.

### 3. New API Routes: `pages/api/growth-intelligence/`

**Rationale**: New route handlers that call Growth Intelligence services and return JSON. No mutations.

**Safe because**: New files only; no edits to existing `/api/executive/*`, `/api/analytics/*`, or `/api/performance/*`.

### 4. Extending Existing API Responses (Optional)

**Rationale**: Add a `growth_score` (or similar) to responses of `/api/executive/campaign-health` or `/api/analytics/report` by calling a Growth Intelligence service and merging the result. Still read-only from DB perspective.

**Safe because**: No schema changes; only additional computed fields in the response.

---

## SECTION 11 — Final Recommendation

### Directory Structure

```
backend/services/growthIntelligence/
  index.ts                    # Exports
  growthIntelligenceService.ts  # Core read-only aggregations
  metrics/
    contentVelocity.ts        # Scheduled/planned counts
    publishingSuccess.ts      # Status-based success rate
    engagementScore.ts        # content_analytics + post_comments
    communityEngagement.ts    # community_ai_actions executed
    opportunityActivation.ts  # campaign_versions from opportunities
  types.ts                    # Shared types
```

### Suggested Service Names

- `getContentVelocityMetrics(companyId, campaignId?, timeframe?)`
- `getPublishingSuccessMetrics(companyId, campaignId?)`
- `getEngagementScore(companyId, campaignId?, timeframe?)`
- `getCommunityEngagementMetrics(organizationId, timeframe?)`
- `getOpportunityActivationMetrics(companyId)`
- `getGrowthIntelligenceSummary(companyId, campaignId?, options?)`

### Suggested API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/growth-intelligence/summary` | GET | `companyId`, `campaignId?` → aggregated growth metrics |
| `/api/growth-intelligence/content-velocity` | GET | Content planning/scheduling velocity |
| `/api/growth-intelligence/publishing-success` | GET | Publish success/failure rates |
| `/api/growth-intelligence/engagement` | GET | Engagement metrics |
| `/api/growth-intelligence/community` | GET | Community AI actions executed |
| `/api/growth-intelligence/opportunity-activation` | GET | Opportunity → campaign conversion |

All routes: `companyId` (or `organizationId` for community) in query; existing `getSupabaseUserFromRequest` + `withRBAC` for auth.

### Confirmation: Phase-1 Without Modifying Existing Modules

**YES.** Phase-1 can be implemented without modifying existing modules:

1. **No schema changes**: All data comes from current tables.
2. **No worker changes**: Growth Intelligence does not touch `publishProcessor`, `engagementPollingProcessor`, or `intelligencePollingWorker`.
3. **No new write paths**: Services and APIs perform SELECT only.
4. **Additive APIs**: New routes under `/api/growth-intelligence/`.
5. **Optional response extension**: If adding `growth_score` to existing endpoints, that is a small, localized change in those handlers; no shared services or DB schema are modified.

---

*Report generated for Growth Intelligence Phase-1 planning. All derivations are read-only from existing data.*
