# FULL ANALYTICS & ENGAGEMENT AUDIT

**Status:** Analysis only. No code changes. No implementation. No refactor.

---

## 1️⃣ Engagement Data Model

### Tables and columns

| Table | Purpose | Key columns | Relationships |
|-------|---------|-------------|---------------|
| **scheduled_posts** | Posts to publish / published. | id, user_id, social_account_id, campaign_id, platform, content_type, content, status (draft \| scheduled \| publishing \| published \| failed \| cancelled), scheduled_for, published_at, platform_post_id, priority, etc. | FK: users, social_accounts, campaigns. Referenced by post_comments, queue_jobs, content_analytics. |
| **post_comments** | Ingested comments per post. | id, scheduled_post_id, platform_comment_id, platform, author_name, author_username, content, platform_created_at, like_count, reply_count, sentiment_score, is_flagged, created_at, updated_at. UNIQUE(scheduled_post_id, platform_comment_id). | FK: scheduled_posts(id) ON DELETE CASCADE. |
| **comment_replies** | Human replies to comments. | comment_id (post_comments), user_id, content, status, sent_at. | FK: post_comments, users. |
| **comment_likes** | User likes on comments. | comment_id, user_id, platform_like_id. UNIQUE(comment_id, user_id). | FK: post_comments, users. |
| **comment_flags** | Flags (spam, inappropriate, etc.). | comment_id, user_id, flag_type, status. | FK: post_comments, users. |
| **content_analytics** | Daily engagement metrics per post (views, likes, shares, etc.). | scheduled_post_id, platform, content_type, date, hour, views, likes, shares, comments, saves, retweets, quotes, reactions, engagement_rate, reach, impressions, created_at. | FK: scheduled_posts(id) ON DELETE CASCADE. |
| **content_performance_metrics** | Time-series metrics by content asset. | content_asset_id, platform, campaign_id, week_number, day, metrics_json (JSONB), captured_at. UNIQUE(content_asset_id, platform, captured_at). | FK: content_assets. Used by analyticsService (listPerformanceMetrics). |
| **campaign_performance** | Campaign-level performance (date / week). | campaign_id, performance_date, total_reach, total_engagement, total_conversions, platform_breakdown (JSONB), content_type_breakdown (JSONB), week_number, week_start_date, week_end_date, target_reach (in extended schema). | FK: campaigns. |
| **campaign_performance_metrics** | Campaign metrics by week/platform/date (enhanced schema). | campaign_id, week_number, platform, date, impressions, reach, likes, comments, shares, saves, clicks, conversions, engagement_rate, click_through_rate, etc. | FK: campaigns. |
| **platform_metrics_snapshots** | Daily snapshots per company/platform (followers, engagement_rate). | company_id, platform, followers, engagement_rate, captured_at. | No FK. Read for baseline. |
| **community_ai_actions** | Suggested actions from engagement evaluation (like, reply, share, follow, schedule). | tenant_id, organization_id, platform, action_type, target_id, suggested_text, status (pending \| approved \| rejected), requires_approval, created_at. | No FK to scheduled_posts. |
| **engagement_rules** | User-defined rules (auto_reply, auto_like, etc.). | user_id, platform, rule_name, rule_type, trigger_conditions (JSONB), action_config (JSONB), is_active. | FK: users. |

### Where engagement is stored

- **Per comment:** `post_comments` — one row per comment; upsert key `(scheduled_post_id, platform_comment_id)`. Each row has like_count, reply_count; no separate likes table for platform-ingested likes.
- **Per post (aggregate metrics):** `content_analytics` — one row per post per date (and optionally hour). Holds views, likes, shares, comments, saves, retweets, quotes, reactions, engagement_rate, reach, impressions.
- **scheduled_posts:** In `step3-scheduling-tables.sql`, scheduled_posts has columns views, likes, shares, comments, saves, retweets, quotes, reactions, engagement_rate; in `complete-reset-and-apply.sql` these are not present on scheduled_posts — they live on content_analytics. Schema varies by migration; the app uses content_analytics (and content_performance_metrics) for analytics.

### Historical behavior

- **post_comments:** Upsert by `(scheduled_post_id, platform_comment_id)`; same comment id updates existing row (updated_at). No per-day history; latest state only.
- **content_analytics:** One row per (scheduled_post_id, date[, hour]). New dates add rows; same date can be updated if logic overwrites. Supports daily history per post.
- **content_performance_metrics:** Append by (content_asset_id, platform, captured_at); multiple rows per asset over time. Supports time series.
- **platform_metrics_snapshots:** Append-only snapshots; multiple rows per (company_id, platform). Supports trends (e.g. follower growth).
- **campaign_performance / campaign_performance_metrics:** Typically one row per campaign per date/week; may be updated (e.g. weekly-performance API PUT). No dedicated “engagement log” table; no explicit per-post-over-time table for ingested engagement.

---

## 2️⃣ Engagement Evaluation Logic

**File:** `backend/services/engagementEvaluationService.ts`

### Inputs

- **scheduled_post_id.**  
- **scheduled_post:** From getScheduledPost (id, campaign_id, platform, platform_post_id, content).  
- **post_comments:** All rows for that scheduled_post_id from post_comments, ordered by platform_created_at.  
- **Tenant/org:** From campaign → campaign_versions → company_id (tenant_id = organization_id = company_id).  
- **Brand voice:** From company profile (brand_voice_list / brand_voice).  
- **Recent cutoff:** Comments with platform_created_at >= now - 24h for “recent_comments”.

### Outputs

- **Return:** `EvaluatePostEngagementResult`: success, actionsCreated (number), error (optional).  
- **Side effect:** Inserts into `community_ai_actions` with status `pending`, requires_approval true. No update to scheduled_posts, no numeric score written to DB.

### Logic (no numeric score, no decay)

- If no post or comments.length === 0 → return success, actionsCreated 0.  
- Resolve tenant/org from campaign; resolve brand_voice.  
- Build input: tenant_id, organization_id, platform, post_data (scheduled_post_id, platform_post_id, content slice, platform), engagement_activity (comments array), engagement_metrics (total_comments, recent_comments), brand_voice, context.  
- Call **evaluateEngagement** (communityAiOmnivyraService) → returns suggested_actions.  
- For each suggested action: best-effort dedupe by (tenant_id, organization_id, platform, target_id, action_type, suggested_text) in community_ai_actions; if not exists, insert one row (action_type in like, reply, share, follow, schedule).  
- **No** engagement score computed. **No** update to scheduled_posts. **No** decay. **No** campaign-level aggregation inside this service. **No** platform normalization of metrics; comments are passed as stored.

### Scoring

- This service does **not** compute or persist any engagement score.  
- **engagementPriorityService** scores **community_ai_actions** at read time (priority_score, priority_label) from action_type and suggested_text; it does not write to DB and is separate from evaluation.

---

## 3️⃣ Campaign-Level Aggregates (Existing or Missing)

### Existing

- **campaign_performance:** campaign_id, performance_date, total_reach, total_engagement, total_conversions, platform_breakdown (JSONB), content_type_breakdown (JSONB). Optional week_number, week_start_date, week_end_date, target_reach (from extensions). Read/written by `pages/api/campaigns/weekly-performance.ts` (GET/POST/PUT).  
- **campaign_performance_metrics:** campaign_id, week_number, platform, date, impressions, reach, likes, comments, shares, saves, clicks, conversions, engagement_rate, click_through_rate, etc. Used by CampaignRoiIntelligenceService and campaignIntelligenceService.  
- **content_performance_metrics:** content_asset_id, platform, campaign_id, week_number, day, metrics_json, captured_at. Used by analyticsService (listPerformanceMetrics) and performanceStore; aggregated by campaign_id for analytics.  
- **analyticsService.computeAnalytics:** Reads content_performance_metrics (by campaignId), computes engagementRate (likes+comments+shares over reach/impressions), bestPlatforms, bestContentTypes, bestTimes, trendSuccess, underperformingAssets, topAssets; saves to analytics_reports.  
- **campaignIntelligenceService:** Can read campaign_performance and campaign_performance_metrics for a campaign; returns metrics with source indicator.  
- **weekly-performance API:** GET/POST/PUT on campaign_performance; weekly targets and totals.  
- **Community AI trends API** (`pages/api/community-ai/trends.ts`): Reads **content_analytics** (likes, comments, shares, views, engagement_rate, date), filters by company; compares current vs previous 7-day windows; returns trend deltas and post-level aggregates.

### Missing / not present

- **campaign_engagement** table: Not found. No dedicated table named campaign_engagement.  
- **Rolling metrics:** No dedicated “last 7/30 days rolling” table; trends are computed in code from content_analytics or content_performance_metrics.  
- **Performance snapshots** at campaign level: campaign_performance and campaign_performance_metrics hold records per date/week but are not explicitly “snapshots” with history retention policy documented.  
- **Automatic backfill** from post_comments or content_analytics into campaign_performance: Not implemented; weekly-performance and campaign metrics are written by other flows (e.g. manual or other jobs), not by engagement ingestion or evaluation.

---

## 4️⃣ Historical Tracking Capability

- **Engagement per post over time:**  
  - **Comments:** Only current state in post_comments (upsert by platform_comment_id). No historical log of comment count or content per day.  
  - **Post-level metrics:** content_analytics has (scheduled_post_id, date, …) so multiple dates per post are possible if something writes them; ingestion path does not write content_analytics.  
- **Latest evaluation only:** Engagement evaluation does not write any “evaluation result” or score to DB; it only creates community_ai_actions. There is no “last evaluation at” or “engagement_score” on scheduled_posts in the main code paths.  
- **Historical engagement log:** No dedicated table that logs “post X had Y comments at time T”. post_comments.updated_at changes on upsert but does not represent a time series of counts.  
- **Impressions:** content_analytics has impressions; content_performance_metrics has metrics_json (can hold anything). platform_metrics_snapshots does not store impressions. Impressions are not populated by the engagement ingestion or evaluation flow.  
- **Reaction weighting:** engagementPriorityService weights action types (reply 40, follow 25, share 20, like 10, schedule 5) for **suggested actions** only. No weighting of likes vs comments vs shares for an overall “engagement score” in the evaluation or ingestion services.  
- **Trends:** Possible only where time-series data exists: content_analytics (if populated), content_performance_metrics, platform_metrics_snapshots, campaign_performance. Comment-level ingestion alone does not provide post-level time series; content_analytics would need to be filled (e.g. by a different job or platform webhooks).

---

## 5️⃣ Existing Analytics UI

- **pages/analytics.tsx:** Fetches `/api/analytics/report` (POST, companyId, campaignId, timeframe). Shows totalReach, totalEngagement, totalConversions, weeklyBreakdown, platformBreakdown. Data comes from analyticsService.computeAnalytics → content_performance_metrics and saved analytics_reports.  
- **pages/creative-dashboard.tsx:** “Analytics” tab; fetches `/api/analytics/posting`. View of “published creative content and performance analytics.”  
- **pages/campaign-details/[id].tsx:** Fetches `/api/governance/campaign-analytics?campaignId=…`; shows governance/audit analytics (not raw engagement). No dedicated “engagement” or “comments” tab in the snippet.  
- **pages/campaign-planning-hierarchical.tsx:** Link to `/analytics?campaignId=…`.  
- **Community AI trends:** API `pages/api/community-ai/trends.ts` serves content_analytics (likes, comments, shares, views, engagement_rate). Any UI that calls this is campaign/company-scoped via tenant scope.  
- **Campaign Intelligence (intelligence observability):** Campaign Intelligence page and summary/timeline APIs are about **strategy/distribution/slot** intelligence, not engagement or comment metrics.  
- **Conclusion:** Analytics UI is campaign- or company-scoped (analytics report, governance campaign-analytics, creative dashboard, trends). There is no dedicated “engagement view” or “post comments” dashboard in the paths reviewed; comment data lives in post_comments and is used by evaluation and (where wired) by Community AI.

---

## 6️⃣ Automation Flow Integrity

- **Engagement polling (engagementPollingProcessor):** Selects scheduled_posts (status=published, platform_post_id not null, published_at >= now - 30 days), limit 50. For each post calls ingestComments(post.id). Per-post try/catch; one failure does not stop the batch. Idempotent at run level: same post can be polled again; ingestion is upsert by (scheduled_post_id, platform_comment_id).  
- **Comments deduplication:** persistComments uses upsert with onConflict: 'scheduled_post_id,platform_comment_id', ignoreDuplicates: false → same comment id updates existing row. No duplicate rows for the same comment.  
- **evaluatePostEngagement:** Called from ingestComments only when ingested > 0. Reads post and comments, calls Community AI, inserts into community_ai_actions with dedupe by (tenant, org, platform, target_id, action_type, suggested_text). Does not update scheduled_posts; no double-write of actions for the same comment set unless suggesteds change.  
- **Race with publishing:** Polling runs on a schedule (e.g. every 10 min); publish path sets status=published and platform_post_id. Polling only selects already-published posts. No shared lock; possible that a post is selected while just published — ingestComments is read-heavy and upserts comments; no evidence of race that corrupts data. Evaluation runs after new comments are persisted; worst case is duplicate suggested actions if two runs process the same new comments before dedupe rows exist; dedupe limits that.

---

## 7️⃣ Gaps for Executive Dashboard

- **Single place for “campaign engagement”:** No single table or API that aggregates post_comments + content_analytics + campaign_performance for a campaign into one executive view.  
- **Comment counts / sentiment at campaign level:** Not aggregated; would require aggregating post_comments by campaign (via scheduled_posts.campaign_id).  
- **Post-level engagement over time:** content_analytics can support it but is not filled by the ingestion pipeline; content_performance_metrics is content_asset–based. No guaranteed “post X, daily snapshot” from current ingestion.  
- **Unified KPI:** total_reach, total_engagement, total_conversions exist on campaign_performance but may not be backfilled from actual engagement ingestion; executive dashboard would need a defined source of truth (e.g. content_analytics vs campaign_performance vs content_performance_metrics).  
- **Trends and comparisons:** Possible only from content_analytics, content_performance_metrics, or campaign_performance where populated; no single “campaign engagement trend” API that combines comments and platform metrics.  
- **Alerts / goals:** No engagement goal or threshold logic found in the audit; would need to be added for “under/over goal” on an executive view.

---

## 8️⃣ Data Quality Risks

- **content_analytics vs post_comments:** content_analytics has likes, comments, shares, etc. per post per date; post_comments has actual ingested comments. If content_analytics is not populated from the same source as ingestion, “comments” in analytics can be stale or zero while post_comments has data.  
- **Multiple metric stores:** campaign_performance, campaign_performance_metrics, content_performance_metrics, content_analytics, platform_metrics_snapshots — different keys (campaign_id, content_asset_id, scheduled_post_id, company_id). Risk of conflicting numbers if different jobs write different subsets.  
- **Evaluation depends on comments only:** evaluatePostEngagement uses only comment count and content; no likes/shares/impressions from platform. If platforms expose more in API, that is not yet fed into evaluation.  
- **30-day polling window:** Only recent published posts are polled; older posts never get comment updates unless another path runs ingestion.  
- **Token/access:** ingestComments fails for a post if token is missing or invalid; polling continues with other posts but that post’s comments stay stale.
