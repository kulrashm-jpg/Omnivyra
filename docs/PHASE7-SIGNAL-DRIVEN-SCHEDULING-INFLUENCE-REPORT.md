# Phase 7 — Signal-Driven Scheduling Influence — Implementation Report

**Date:** 2025-03-07  
**Phase:** 7 — Signals influence scheduling review (opportunity insights only)

---

## 1. Objective

Use signals from `signalIntelligenceEngine` to generate scheduling insights. **Signals do NOT automatically change the schedule** — they only produce opportunity insights. Users decide whether to apply them.

---

## 2. Service: signalSchedulingInfluence.ts

**File:** `backend/services/signalSchedulingInfluence.ts`

### Main function

| Function | Description |
|----------|-------------|
| `analyzeSignalInfluence(weekPlan, companyId, weekStart, weekEnd)` | Retrieves signals via `getSignalsForWeek`, filters by score ≥ 0.6, limits to top 5, converts to `SignalSchedulingInsight[]`. |

### Insight structure

```ts
{
  type: "signal_opportunity",
  signal_type: string,
  signal_topic: string,
  signal_score: number,
  message: string,
  recommendation: string
}
```

**Example:**

```json
{
  "type": "signal_opportunity",
  "signal_type": "industry_trend",
  "signal_topic": "AI regulation",
  "signal_score": 0.82,
  "message": "Trending topic detected: AI regulation.",
  "recommendation": "Consider scheduling content related to AI regulation earlier this week."
}
```

---

## 3. Signal Filtering

- **Source:** `getSignalsForWeek(companyId, weekStart, weekEnd)` from `signalIntelligenceEngine`
- **Filter:** `signal_score ≥ 0.6`
- **Sort:** by `signal_score` descending (already returned sorted)
- **Limit:** top 5 signals

---

## 4. Signal Rules

| Rule | Condition | Message |
|------|-----------|---------|
| RULE 1 | `signal_type = industry_trend` | `"Trending topic detected: {signal_topic}."` |
| RULE 2 | `signal_type = seasonal_event` | `"Upcoming seasonal event may influence audience engagement."` |
| RULE 3 | `signal_type = competitor_activity` | `"Competitor activity detected around {signal_topic}."` |

Additional rules for `company_event` and `market_news` follow analogous patterns.

---

## 5. Integration

### contentDistributionIntelligence

**File:** `backend/services/contentDistributionIntelligence.ts`

- **New function:** `getEnrichedDistributionInsights(weekPlan, options)` — async
- Runs `analyzeWeeklyDistribution` (sync)
- When `companyId`, `campaignStartDate`, `weekNumber` provided: calls `analyzeSignalInfluence` and appends signal insights
- Returns merged `DistributionInsight[]` (signal insights use `severity: 'info'`)

### Consumers

| Consumer | Change |
|----------|--------|
| `pages/api/campaigns/apply-weekly-plan-edits.ts` | Uses `getEnrichedDistributionInsights` — fetches `company_id` from `campaign_versions`, `start_date` from `campaigns` |
| `backend/services/campaignAiOrchestrator.ts` | Uses `getEnrichedDistributionInsights` when setting `distribution_insights` after schedule assignment |

---

## 6. UI

**Weekly board banner:** `components/weekly-board/WeeklyActivityBoard.tsx`

- Displays `distributionInsights[0]?.message` and "(+N more)" when insights exist
- Signal insights use the same `DistributionInsight` shape (type, severity, message, recommendation)
- No UI changes required — signal insights appear like any other improvement

**Example banner text:** "Trending topic detected: AI regulation. (+2 more)"

---

## 7. Confirmation Checklist

| Item | Status |
|------|--------|
| signalSchedulingInfluence service created | ✅ `backend/services/signalSchedulingInfluence.ts` |
| Signal insight structure implemented | ✅ `SignalSchedulingInsight` with type, message, recommendation |
| Signal filtering logic implemented | ✅ score ≥ 0.6, top 5 |
| Integration with distribution intelligence completed | ✅ `getEnrichedDistributionInsights` + apply-weekly-plan-edits + campaignAiOrchestrator |
| Signal insights visible in weekly improvement banner | ✅ via `distribution_insights` → `distributionInsights` → banner |

---

## 8. Files Created / Modified

| File | Change |
|------|--------|
| `backend/services/signalSchedulingInfluence.ts` | **New** — `analyzeSignalInfluence` |
| `backend/services/contentDistributionIntelligence.ts` | **Modified** — `getEnrichedDistributionInsights` |
| `pages/api/campaigns/apply-weekly-plan-edits.ts` | **Modified** — uses enriched insights |
| `backend/services/campaignAiOrchestrator.ts` | **Modified** — uses enriched insights |
| `backend/tests/unit/signalSchedulingInfluence.test.ts` | **New** — unit tests |
