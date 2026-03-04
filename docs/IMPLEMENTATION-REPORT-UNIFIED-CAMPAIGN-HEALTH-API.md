# Implementation Report: Unified Campaign Health API

**Status:** Analysis + implementation of new read-only API only. No refactor, no modification of existing logic, no schema changes.

---

## 1️⃣ API File Created

- **Path:** `pages/api/executive/campaign-health.ts`
- **Method:** GET only.
- **Query:** `campaignId` (required).
- **Auth:** `requireCampaignAccess(req, res, campaignId)` from `backend/services/campaignAccessService`. Returns 400 if `campaignId` missing; response is sent by access layer if unauthorized.
- **Response:** JSON body conforming to `CampaignHealthSummary` (TypeScript type exported from the same file).
- **Behavior:** Read-only projection over existing tables; all table access wrapped in try/catch; missing tables or errors yield zeros/nulls and STABLE where applicable. Returns 200 on success; 500 only on unexpected handler failure (e.g. before sending response).

---

## 2️⃣ Data Sources Used

| Metric | Source | Fallback | Notes |
|--------|--------|----------|--------|
| Engagement (last/previous 7 days) | `campaign_performance_metrics` (sum of likes + comments + shares by date range) | `campaign_performance` (sum of total_engagement by performance_date range) | Date ranges: last 7 = [today-6, today], previous 7 = [today-13, today-7]. |
| Reach (last/previous 7 days) | `campaign_performance_metrics` (sum of reach by date range) | `campaign_performance` (sum of total_reach by performance_date range) | Same date ranges; used only for reach_trend_percent. |
| Comments (last/previous 7 days) | `post_comments` | — | Post IDs from `scheduled_posts` where campaign_id = campaignId; count comments by created_at in each 7-day window. |
| Stability level & volatility | `campaign_distribution_decisions` (week_number, resolved_strategy) | — | Passed to `computeDistributionStability()` from `lib/intelligence/distributionStability`. If table missing or &lt; 2 rows: STABLE, volatility 0. |
| Strategist acceptance rate | `campaign_strategic_memory` (action, accepted, created_at) | — | Events → `buildStrategicMemoryProfile()`; average of action_acceptance_rate across IMPROVE_CTA, IMPROVE_HOOK, ADD_DISCOVERABILITY. Null if no rows. |
| Auto distribution ratio | `campaign_distribution_decisions` (auto_detected) | — | Count where auto_detected === true / total count. Null if no rows. |
| Slot optimization count | `campaign_distribution_decisions` (slot_optimization_applied) | — | Count where slot_optimization_applied === true. |

All queries use Supabase client with explicit filters (no joins that depend on FK constraints). No writes; no schema or data mutations.

---

## 3️⃣ Trend Computation

- **Formula:** `trend_percent = ((current - previous) / previous) * 100`, rounded to nearest integer.
- **Rules:**
  - If `previous === 0` and `current > 0` → **100**.
  - If both `previous === 0` and `current === 0` → **0**.
  - If `previous === 0` and `current === 0` → **0** (same as above).
  - Otherwise `Math.round(((current - previous) / previous) * 100)`; can be null only when no data (no rows in either source).
- **Applied to:** engagement (total_engagement_last_7_days vs total_engagement_previous_7_days) and reach (same windows) → `engagement_trend_percent`, `reach_trend_percent`. Either can be null when there is no data in performance tables.

---

## 4️⃣ Health Classification Logic

- **performance_health:** `'GROWING' | 'STABLE' | 'DECLINING'`.
- **Rules:**
  - If `engagement_trend_percent > 10` → **GROWING**.
  - If `engagement_trend_percent < -10` → **DECLINING**.
  - Else (including null or in [-10, 10]) → **STABLE**.
- No data (null trend) → **STABLE**.

---

## 5️⃣ Alert Logic

Alerts are human-readable sentences appended to the `alerts` array when conditions hold:

| Condition | Alert text |
|-----------|------------|
| `engagement_trend_percent != null` and `&lt; -15` | "Engagement has declined compared to the previous week." |
| `total_comments_last_7_days === 0` | "No new comments were received in the last 7 days." |
| `stability_level === 'VOLATILE'` | "Posting strategy has been volatile across recent weeks." |
| `strategist_acceptance_rate != null` and `&lt; 0.3` | "Few suggested improvements have been applied recently." |
| `auto_distribution_ratio != null` and `&gt; 0.9` | "Distribution is almost entirely auto-selected; consider setting a strategy." |

Multiple alerts can be returned; no marketing jargon.

---

## 6️⃣ Edge Case Handling

- **Missing table or query error:** Each data source is in its own try/catch. On error or missing table, that metric is left at default (0, null, or STABLE/0 for stability). No throw; execution continues.
- **Empty result sets:** Zeros and nulls used (e.g. no performance rows → engagement/reach trends null, totals 0; no decisions → STABLE, volatility 0, auto_ratio null, slot count 0; no memory → strategist_acceptance_rate null).
- **No scheduled_posts for campaign:** Comment query returns no IDs → total_comments_last_7_days and total_comments_previous_7_days = 0.
- **post_comments created_at:** Filtering by `created_at` in the two 7-day windows (ingestion time). No FK join; we fetch post IDs then filter comments by `scheduled_post_id in (...)` and bucket by date in code.
- **Date boundaries:** Last 7 days = from (today - 6) 00:00 through today end-of-day; previous 7 = (today - 13) through (today - 7) end-of-day. All in UTC.
- **Auth failure:** Handled by `requireCampaignAccess` (sends 401/403 and returns); handler does not send 200 in that case.
- **Missing campaignId:** 400 and JSON error; no 200.

---

## 7️⃣ Example Response

```json
{
  "campaign_id": "550e8400-e29b-41d4-a716-446655440000",
  "engagement_trend_percent": 12,
  "reach_trend_percent": 5,
  "total_engagement_last_7_days": 340,
  "total_engagement_previous_7_days": 303,
  "total_comments_last_7_days": 8,
  "total_comments_previous_7_days": 3,
  "stability_level": "STABLE",
  "volatility_score": 20,
  "strategist_acceptance_rate": 0.65,
  "auto_distribution_ratio": 0.75,
  "slot_optimization_applied_count": 2,
  "performance_health": "GROWING",
  "alerts": []
}
```

Example with alerts (declining engagement, no comments, volatile):

```json
{
  "campaign_id": "550e8400-e29b-41d4-a716-446655440000",
  "engagement_trend_percent": -18,
  "reach_trend_percent": null,
  "total_engagement_last_7_days": 45,
  "total_engagement_previous_7_days": 55,
  "total_comments_last_7_days": 0,
  "total_comments_previous_7_days": 2,
  "stability_level": "VOLATILE",
  "volatility_score": 67,
  "strategist_acceptance_rate": 0.2,
  "auto_distribution_ratio": 0.95,
  "slot_optimization_applied_count": 1,
  "performance_health": "DECLINING",
  "alerts": [
    "Engagement has declined compared to the previous week.",
    "No new comments were received in the last 7 days.",
    "Posting strategy has been volatile across recent weeks.",
    "Few suggested improvements have been applied recently.",
    "Distribution is almost entirely auto-selected; consider setting a strategy."
  ]
}
```

---

## Summary

- **Created:** `pages/api/executive/campaign-health.ts` (GET, read-only).
- **Uses:** campaign_performance_metrics → campaign_performance (engagement/reach); scheduled_posts + post_comments (comments); campaign_distribution_decisions (stability, auto ratio, slot count); campaign_strategic_memory (strategist acceptance).
- **Unchanged:** distributionEngine, evaluation service, generation pipeline, existing APIs, schema. Projection only.
