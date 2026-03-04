# Stage 1 + 2 — AI Cost Visibility Upgrade — Implementation Report

**Status:** Extended existing APIs and UI. No schema changes. No service modifications. Read-only queries only.

---

## 1. Files Modified

| File | Change |
|------|--------|
| `pages/api/system/overview.ts` | Added `top_campaigns_by_cost` to response type and computation. |
| `pages/system-dashboard.tsx` | Added "Top Campaigns by AI Cost" under AI Consumption. |
| `pages/api/executive/campaign-health.ts` | Added `ai_spend_last_30_days` to `CampaignHealthSummary` and computation. |
| `pages/campaign-health/[id].tsx` | Added `ai_spend_last_30_days` to Health type; added "AI Spend (Last 30 Days)" section in Enterprise mode only. |

---

## 2. API Response Changes

### System Overview (`GET /api/system/overview`)

**Added to response:**

```ts
top_campaigns_by_cost: Array<{
  campaign_id: string;
  campaign_name: string;
  total_tokens: number;
  total_cost: number;
  percent_of_total_cost: number;
}>;
```

- **Source:** `usage_events` where `source_type = 'llm'`, `campaign_id IS NOT NULL`, `created_at >= now - range_days`.
- **Logic:** Group by `campaign_id` (in memory), SUM(total_tokens), SUM(total_cost), order by total_cost DESC, limit 5. Join to `campaigns` for `name`. `percent_of_total_cost = (total_cost / ai_consumption.total_cost) * 100` (denominator 1 if total cost 0).
- **Empty:** If no rows with campaign_id, returns `[]`. Wrapped in try/catch; on error keeps empty array.

### Executive Campaign Health (`GET /api/executive/campaign-health?campaignId=...`)

**Added to response:**

```ts
ai_spend_last_30_days: {
  total_tokens: number;
  total_cost: number;
  llm_calls: number;
}
```

- **Source:** `usage_events` where `source_type = 'llm'`, `campaign_id = campaignId`, `created_at >= now - 30 days`.
- **Logic:** SUM(total_tokens), SUM(total_cost), COUNT(*) as llm_calls. On no rows or error, returns zeros. Wrapped in try/catch.

---

## 3. UI Additions

### System Dashboard (`/system-dashboard`)

- **Section:** "Top Campaigns by AI Cost" inside the existing **AI Consumption** card, below "Tokens by process type".
- **Content:** Ranked list (1–5): campaign name, total cost, tokens, "% of total". Simple list, no charts.
- **Empty state:** "No campaign-level AI usage in selected period." when `top_campaigns_by_cost` is empty or missing.

### Campaign Health (`/campaign-health/[id]`)

- **Section:** "AI Spend (Last 30 Days)" — **Enterprise mode only**, placed below "Execution intelligence" and above "AI suggestion behavior".
- **Content:** Total cost, Total tokens, LLM calls (same layout as other metric blocks).
- **Zeros / missing:** "No AI activity recorded in last 30 days." when `ai_spend_last_30_days` is missing or all values are zero.
- **Creator mode:** Section not rendered.

---

## 4. Edge Cases

| Case | Handling |
|------|----------|
| `usage_events` table missing | System overview: top_campaigns_by_cost try/catch → `[]`. Campaign health: ai_spend try/catch → zeros. |
| No LLM rows with campaign_id | System overview: `top_campaigns_by_cost = []`; UI shows empty state. |
| Campaign deleted (id in usage_events, not in campaigns) | System overview: name falls back to first 8 chars of campaign_id. |
| ai_consumption.total_cost === 0 | percent_of_total_cost uses denominator 1 to avoid division by zero; percentages can sum to >100 for the top-5 slice. |
| Campaign health API called without ai_spend (e.g. old client) | Health type has `ai_spend_last_30_days?` optional; UI checks presence and zero values before showing metrics. |
| usage_events.campaign_id type (UUID vs string) | Queries use string campaignId; Supabase accepts for UUID columns. |

---

## 5. Safety

- No schema changes.
- No changes to usage logging or usage_meter.
- No new tables.
- All new queries are read-only.
- TypeScript: no new errors; existing response shapes extended only.

---

## 6. Manual Verification Checklist

1. **Campaign plan generation**  
   Run campaign plan generation; confirm `usage_events` has rows with `campaign_id` set for that campaign.

2. **System dashboard**  
   Visit `/system-dashboard`, choose range (e.g. 7d).  
   - If there is campaign-level LLM usage in range: confirm "Top Campaigns by AI Cost" shows up to 5 campaigns with name, cost, tokens, and % of total.  
   - If none: confirm "No campaign-level AI usage in selected period."

3. **Campaign health (Enterprise)**  
   Visit `/campaign-health/[id]`, switch to **Enterprise View**.  
   - If the campaign has LLM usage in last 30 days: confirm "AI Spend (Last 30 Days)" shows Total cost, Total tokens, LLM calls.  
   - If none: confirm "No AI activity recorded in last 30 days."

4. **Creator mode**  
   On `/campaign-health/[id]` in Creator View, confirm the AI Spend section is not visible.

---

## 7. Result

- **System-wide:** System dashboard shows top 5 campaigns by AI cost for the selected range.
- **Campaign-level:** Campaign health (Enterprise) shows last-30-day AI spend per campaign.
- **Foundation:** Enables future budget enforcement and cost alerts using the same read-only projections.
