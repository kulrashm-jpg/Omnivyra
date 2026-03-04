# Analytics Pages, APIs, and Executive Health — Detailed Report

---

## 1️⃣ Existing Analytics Pages

| Page | Route | Scope | Main sections | Charts | Tabs |
|------|--------|--------|----------------|--------|------|
| **Analytics** | `/analytics` (optional `?campaignId=`) | Company (companyId from context); optional campaign filter | Key metrics (Total Reach, Total Engagement, Total Conversions); Weekly Performance (list); Platform Performance (grid of platform cards) | None (raw numbers and lists only) | No |
| **Creative Dashboard** | `/creative-dashboard` | Company (schedule/posts not campaign-scoped in API) | Creative tools; Scheduled posts (filter by platform/status); Published; **Analytics** tab (placeholder) | None | Yes: Creative, Scheduled, Published, Analytics |
| **Campaign Details** | `/campaign-details/[id]` | Campaign | Governance status, events, **campaign-analytics** (ROI, optimization insights, auto-optimize), AI chat, projection, replay, etc. | Governance/audit UI; no engagement charts | Yes (many) |
| **Analytics Dashboard** | `/analytics-dashboard` (query `campaignId` or `id`) | Campaign | Summary cards (Total Posts, Total Engagement, Avg Engagement Rate, Top Platform); Platform metrics; Post-level analytics list; date range and platform filters | None (cards and lists) | No |
| **Campaign Intelligence** | `/campaign-intelligence/[id]` | Campaign | Platform confidence; Strategist acceptance; Strategy decisions; Slot optimization; Generation bias; Distribution stability; Decision timeline | None (badges and lists) | No |

**Other mentions**

- **Scheduling Dashboard** (`/scheduling-dashboard`): scheduling-focused; not an analytics page.
- **Recommendations analytics** (`/recommendations/analytics`): recommendation/strategy analytics, not campaign performance.
- **Community AI Executive** (`/community-ai/executive`): Community AI lens; not the same as campaign health.

**Summary**

- **Campaign-scoped:** Campaign Details, Analytics Dashboard, Campaign Intelligence.
- **Company-scoped (with optional campaign):** Analytics.
- **Company-scoped (no campaign):** Creative Dashboard.
- **Charts:** No Recharts/Chart.js on the listed pages; metrics are cards, lists, and grids.

---

## 2️⃣ Data Flow & APIs Used

### Analytics (`/analytics`)

| API | Method | Body/Query | Return shape (expected by page) | Actual return shape |
|-----|--------|------------|----------------------------------|----------------------|
| `/api/analytics/report` | POST | companyId, campaignId?, timeframe | totalReach, totalEngagement, totalConversions, weeklyBreakdown[], platformBreakdown{} | **Mismatch:** computeAnalytics returns engagementRate, bestPlatforms, bestContentTypes, bestTimes, trendSuccess, underperformingAssets, topAssets + playbook fields. **No** totalReach, totalEngagement, weeklyBreakdown, platformBreakdown. |

- **Server:** `analyticsService.computeAnalytics` reads **content_performance_metrics** (listPerformanceMetrics), computes engagement = likes+comments+shares, reach from metrics_json; aggregates by platform/contentType/time/trend; writes to **analytics_reports**; returns the report object above (no 7-day or platform breakdown).
- **Client:** Displays totalReach, totalEngagement, totalConversions, weeklyBreakdown (week, reach, engagement, conversions), platformBreakdown (reach, engagement, conversions). With current API these render as 0/undefined/empty.
- **Client-side computation:** None (only formatting/toLocaleString).

### Creative Dashboard (`/creative-dashboard`)

| API | Method | Return shape | Notes |
|-----|--------|--------------|--------|
| `/api/analytics/posting` | GET | success, data: { platformBreakdown, topPerformingPosts, engagementTrends, optimalPostingTimes, ... } | **Mock only.** No DB; hardcoded platform stats and fake trends. |
| `/api/schedule/posts` | GET | Posts list | For scheduled/published list. |

- **Server:** Posting API returns static mock data.
- **Client:** loadAnalytics stores result in state; Analytics tab is a single placeholder card (“Creative Analytics Dashboard”) and does not render the returned data.
- **Client-side computation:** None for analytics.

### Campaign Details (`/campaign-details/[id]`)

| API | Method | Return shape | Notes |
|-----|--------|--------------|--------|
| `/api/governance/campaign-analytics?campaignId=` | GET | GovernanceCampaignAnalytics + roiIntelligence, optimizationInsights, optimizationProposal, autoOptimizationEligibility, autoOptimizeEnabled | Governance + ROI + optimization. |
| `/api/governance/campaign-status?campaignId=&companyId=` | GET | Status | — |
| `/api/analytics/toggle-auto-optimize` | POST | — | Toggle auto-optimize. |

- **Server (campaign-analytics):** GovernanceAnalyticsService (campaign_governance_events, campaigns, scheduled_posts, projection status, replay, policy version); CampaignRoiIntelligenceService (campaign_performance_metrics / scheduled_posts); CampaignOptimizationIntelligenceService; CampaignOptimizationProposalService; Auto-optimization guard. **Tables:** campaign_governance_events, campaigns, scheduled_posts, campaign_performance_metrics (for ROI).
- **Client:** Passes governanceAnalytics (including roiIntelligence, optimizationInsights, optimizationProposal, autoOptimizeEnabled) into campaign-details UI and AI chat context.
- **Client-side computation:** None for analytics.

### Analytics Dashboard (`/analytics-dashboard`)

| API | Method | Return shape | Notes |
|-----|--------|--------------|--------|
| `/api/analytics/platform/[platform]?campaign_id=` | GET | Platform metrics | Per-platform. |
| `/api/campaigns/[id]/posts` or similar | GET | posts[] | Campaign posts. |
| `/api/analytics/post/[postId]` | GET | Post-level analytics | Per post. |

- **Server:** Platform/post APIs read from analytics tables (structure varies); campaign summary is **computed on the client** by aggregating post-level analytics (total engagement, avg engagement rate).
- **Client:** Fetches all platforms (or one), then for each post fetches post analytics; reduces to total_engagement, avg_engagement_rate, total_posts; setCampaignSummary from that. Date range filter (7d/30d/90d/all) applied client-side via getDateFilter (used in loadAnalytics flow). top_performing_platform is hardcoded “linkedin”.
- **Client-side computation:** Campaign summary (totals, averages); date filtering intent (implementation may not filter API calls by date).

### Campaign Intelligence (`/campaign-intelligence/[id]`)

| API | Method | Return shape | Notes |
|-----|--------|--------------|--------|
| `/api/intelligence/summary?campaignId=` | GET | total_feedback_events, action_acceptance_rate, platform_confidence_average, distribution_strategy_counts, slot_optimization_applied_count, active_generation_bias | Strategic memory + distribution counts. |
| `/api/intelligence/decision-timeline?campaignId=` | GET | decisions[], stability (total_weeks, strategy_switches, volatility_score, stability_level) | campaign_distribution_decisions + computeDistributionStability. |

- **Server:** summary → campaign_strategic_memory, campaign_distribution_decisions; decision-timeline → same decisions table + stability.
- **Client:** Renders platform confidence, strategist acceptance, strategy counts, slot optimization, generation bias, stability, timeline. confidenceLevel/confidenceColorClass and formatPlatform are client-side helpers.
- **Client-side computation:** Display helpers only; no metric math.

### Other APIs (for completeness)

- **GET /api/campaigns/metrics?campaignId=** (campaign_performance_metrics): Returns metrics[], aggregated (totalReach, platformBreakdown, weeklyBreakdown by week_number with engagements, impressions, etc.), summary. **Not used by /analytics**; analytics page uses /api/analytics/report instead.
- **analyticsService** also exposes recordPostAnalytics, getPostAnalytics, getPlatformPerformance (content_analytics, platform_performance, hashtag_performance) — used by other flows, not by the analytics pages above in a direct way.

---

## 3️⃣ Metric Overlap With `/api/executive/campaign-health`

| Metric / concept | Executive campaign-health | Where it appears today | Recommendation |
|------------------|---------------------------|-------------------------|----------------|
| **Engagement totals (7-day)** | total_engagement_last_7_days, total_engagement_previous_7_days | Not in current analytics pages in this form. Analytics report has no 7-day split; analytics-dashboard aggregates all post analytics (no explicit last/previous 7). | **Executive health as single source** for 7-day engagement. Keep detailed breakdowns in analytics. |
| **Reach totals** | total_reach only via trend (reach_trend_percent) | analytics.tsx expects totalReach (from report that doesn’t provide it); metrics API has totalReach from campaign_performance_metrics. | **Executive:** trend only. **Reuse:** GET /api/campaigns/metrics (or equivalent) for detailed reach in analytics views. |
| **Weekly breakdown** | No (executive is summary + trends) | analytics.tsx expects weeklyBreakdown[]; GET /api/campaigns/metrics has weeklyBreakdown by week_number. | **Keep in detailed analytics** (metrics API). Do not move to executive; executive stays high-level. |
| **Engagement rate** | No (executive has trend %, not rate) | analyticsService computes engagementRate (engagement/reach); analytics-dashboard computes avg_engagement_rate from posts. | **Keep in detailed analytics.** Executive stays trend + health. |
| **Trend (engagement/reach)** | engagement_trend_percent, reach_trend_percent (last 7 vs previous 7) | No other page computes this exact 7-day comparison. | **Owned by executive health.** Optional: expose same logic for reuse (e.g. “trend” in analytics). |
| **Comments (7-day)** | total_comments_last_7_days, total_comments_previous_7_days | No other analytics page shows comment counts from post_comments. | **Executive only** for now. |
| **Stability / volatility** | stability_level, volatility_score | Campaign Intelligence (decision-timeline API). | **Reuse** decision-timeline (or same stability computation); executive can keep its own read for one-call summary. |
| **Strategist acceptance** | strategist_acceptance_rate (average) | Campaign Intelligence (action_acceptance_rate per action). | **Reuse** intelligence/summary; executive provides single rate for at-a-glance. |
| **Auto distribution ratio** | auto_distribution_ratio | Not surfaced elsewhere. | **Executive only.** |
| **Slot optimization count** | slot_optimization_applied_count | Campaign Intelligence (same source). | **Reuse** same source; executive includes for one-call. |
| **Health classification** | performance_health (GROWING/STABLE/DECLINING) | Nowhere else. | **Executive only.** |
| **Alerts** | alerts[] | Nowhere else. | **Executive only.** |
| **Platform breakdown** | No | analytics.tsx (expected from report), metrics API. | **Remain in detailed analytics** (metrics API or fixed report). |

**Deprecate vs reuse**

- **Do not deprecate:** Campaign Intelligence (strategy/stability/memory); GET /api/campaigns/metrics (aggregated metrics for detailed views); governance campaign-analytics (ROI, optimization, governance).
- **Reuse for executive:** campaign_performance_metrics / campaign_performance (engagement/reach 7-day); campaign_distribution_decisions (stability, auto ratio, slot count); campaign_strategic_memory (strategist rate); post_comments + scheduled_posts (comments). Executive is a **projection** over these; no need to duplicate storage.
- **Fix, then keep:** `/api/analytics/report` and `/analytics` page: either (a) have report return or merge totalReach, totalEngagement, totalConversions, weeklyBreakdown, platformBreakdown (e.g. from campaign_performance_metrics or metrics API), or (b) switch the page to GET /api/campaigns/metrics and map aggregated to the current UI shape. One of these should be done so the page shows real data.
- **Deprecate or replace mock:** `/api/analytics/posting` (mock); Creative Dashboard Analytics tab can later call a real endpoint (e.g. executive health or a dedicated posting-stats API).

---

## 4️⃣ UX Complexity Assessment

| Page | Density | Charts vs numbers | Beginner-friendly | Overwhelming? | Terminology |
|------|---------|-------------------|-------------------|---------------|-------------|
| **Analytics** | Low–medium (3 KPIs + weekly list + platform grid) | Raw numbers only | Yes (simple labels) | No | “Reach”, “Engagement”, “Conversions” — standard marketing. |
| **Creative Dashboard** | Medium (tabs, filters, cards) | Numbers in mock; Analytics tab is one card | Moderate (many actions) | Slightly (many options) | “Creative”, “Analytics” — moderate. |
| **Campaign Details** | High (governance, ROI, optimization, replay, AI chat) | No charts; many sections | No (governance/audit focus) | Yes for non-experts | “Projection”, “Replay”, “ROI”, “Optimization” — specialist. |
| **Analytics Dashboard** | Medium (summary cards + platform list + post list) | Raw numbers | Yes | No | “Engagement rate”, “Top platform” — clear. |
| **Campaign Intelligence** | Medium (sections for confidence, acceptance, strategy, stability, timeline) | Badges and lists | Moderate (needs “intelligence” context) | No | “Strategist acceptance”, “Generation bias” — product-specific but readable. |

**Summary**

- **Density:** Campaign Details is the densest; others are moderate.
- **Charts:** None on these pages; all numeric/card/list.
- **Beginner-friendly:** Analytics and Analytics Dashboard are; Campaign Details is not; Campaign Intelligence is in between.
- **Overwhelming:** Only Campaign Details is clearly overwhelming for a non-technical user.
- **Terminology:** Mostly standard (reach, engagement, conversions); Campaign Details and Campaign Intelligence use more product/internal terms (projection, replay, strategist, bias).

---

## 5️⃣ Recommendation: A / B / C / D (with reasoning)

**Recommendation: C) Keep analytics page but add executive mode above it.**

**Reasoning**

1. **Executive health is a distinct need.** `/api/executive/campaign-health` gives one-call health, trends, alerts, and strategy signals. That is “above” detailed analytics (which should keep weekly/platform/post-level detail). Adding an **executive mode** (or an executive section/card at the top of analytics) gives a single place for “how is this campaign doing?” without replacing existing analytics.
2. **Existing analytics is underpowered, not wrong.** The main issue is that `/analytics` calls an API that doesn’t return the shape it expects (totalReach, weeklyBreakdown, platformBreakdown). Fixing that (or switching to metrics API) preserves the “detailed” view. Replacing the whole page with only executive health would remove weekly and platform breakdown.
3. **Campaign Intelligence is complementary.** It explains *why* (strategy, stability, acceptance, bias). Executive health answers “how healthy?” and “what to watch?” (alerts). Both should stay; executive can link to Campaign Intelligence for drill-down.
4. **Option A** (keep current as “Enterprise”, new “Creator” dashboard) splits surfaces without a clear “one place” for executives. **Option B** (replace analytics entirely with executive) loses detail. **Option D** (merge analytics into “executive intelligence”) would mix high-level health with detailed tables and increase cognitive load.
5. **Concrete shape for C:**  
   - Add an **Executive summary** section at the top of `/analytics` (and optionally on campaign-details): one card or compact block powered by GET `/api/executive/campaign-health?campaignId=`: performance_health, engagement_trend_percent, key alerts, link to “Full intelligence” (Campaign Intelligence) and “Detailed analytics” (rest of same page).  
   - Fix `/api/analytics/report` (or wire `/analytics` to GET `/api/campaigns/metrics`) so the existing Key Metrics + Weekly + Platform sections show real data.  
   - Keep Campaign Details and Campaign Intelligence as-is for governance and strategy depth; optional: add a small “Campaign health” callout on campaign-details that uses executive health.

---

## 6️⃣ Migration Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| **Add executive mode/section** (new UI calling campaign-health API) | Low | New read-only API; no schema or behavior change. Optional feature. |
| **Fix analytics report vs page shape** (report to return or merge totals + weekly + platform) | Low–medium | Possible breaking change if other clients use report. Prefer extending report with optional fields or a dedicated “dashboard” response; or point page to GET /api/campaigns/metrics and adapt client. |
| **Switch /analytics to GET /api/campaigns/metrics** | Low | Page must map aggregated.weeklyBreakdown (by week_number) to the current list shape (week, reach, engagement, conversions). |
| **Deprecate /api/analytics/posting mock** | Low | Only Creative Dashboard uses it; Analytics tab is placeholder. Replace with real API or redirect to executive health when campaign context exists. |
| **Unify “engagement 7-day” logic** (executive vs future analytics) | Low | Executive is the canonical 7-day comparison; any other “trend” view can call same API or reuse same logic to avoid drift. |
| **Campaign Intelligence vs executive health** | Low | Clear split: Intelligence = strategy/memory/stability detail; Executive = health + alerts + one number for trend/acceptance. No need to merge; link between them. |

**Overall:** Adding executive mode and fixing analytics data source are low-risk. Deprecating or replacing the posting mock is low-risk. Keeping Campaign Intelligence and detailed analytics separate from executive health avoids regressions and preserves clarity.
