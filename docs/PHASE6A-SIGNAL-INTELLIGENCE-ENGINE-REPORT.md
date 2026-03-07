# Phase 6A — Signal Intelligence Engine — Implementation Report

**Date:** 2025-03-07  
**Phase:** 6A — Signal system for scheduling influence  

---

## 1. Objective

Introduce a **Signal Intelligence Engine** that captures external signals and scores them. Signals represent market activity that may influence scheduling decisions. This engine does **not** modify schedules; it only stores and scores signals.

---

## 2. Database Table

**File:** `database/scheduling_intelligence_signals.sql`

**Note:** Table named `scheduling_intelligence_signals` (not `intelligence_signals`) because `intelligence_signals` already exists with a different schema for API-sourced signals.

| Column            | Type       | Description                    |
|-------------------|------------|--------------------------------|
| id                | UUID       | Primary key, default gen_random_uuid() |
| company_id        | UUID       | Company reference              |
| signal_type       | TEXT       | industry_trend, competitor_activity, etc. |
| signal_source     | TEXT       | news, api, social, etc.        |
| signal_topic      | TEXT       | Topic description              |
| signal_score      | NUMERIC    | 0–1 composite score           |
| signal_timestamp  | TIMESTAMPTZ| When the signal occurred       |
| metadata          | JSONB      | Additional data                |
| created_at        | TIMESTAMPTZ| Record creation time           |

**Indexes:** `(company_id, signal_timestamp)`, `(company_id, signal_score)`, `signal_type`, week-range.

**Run migration:**
```bash
psql $DATABASE_URL -f database/scheduling_intelligence_signals.sql
```

---

## 3. Service: signalIntelligenceEngine.ts

**File:** `backend/services/signalIntelligenceEngine.ts`

### Functions

| Function | Description |
|----------|-------------|
| `recordSignal(signal)` | Insert signal into `scheduling_intelligence_signals`. Computes score via `scoreSignal()` unless `signal_score` is provided. |
| `scoreSignal(signal)` | Compute composite score from recency, topic relevance, and source reliability. |
| `getSignalsForWeek(companyId, weekStart, weekEnd)` | Return signals in date range, sorted by `signal_score` descending. |

### Types

- **SchedulingSignalInput:** `company_id`, `signal_type`, `signal_source`, `signal_topic`, `signal_timestamp`, optional `metadata`, optional `signal_score` / `topic_relevance` / `source_reliability`.
- **SchedulingSignalType:** `industry_trend`, `competitor_activity`, `company_event`, `seasonal_event`, `market_news`.

---

## 4. Scoring Logic

Formula:
```
signal_score = recencyWeight × 0.4 + topicRelevance × 0.4 + sourceReliability × 0.2
```

All factors normalized to [0, 1].

| Factor | Source |
|--------|--------|
| recencyWeight | Derived from `signal_timestamp` age: 0–24h=1, 24–48h=0.8, 48–72h=0.6, 3–7d=0.4, 7+d=0.2 |
| topicRelevance | Input `metadata.topic_relevance` or default 0.7 |
| sourceReliability | Input `metadata.source_reliability` or mapped from `signal_source`: news=0.9, api=0.85, internal=0.8, social=0.7, etc. |

---

## 5. Retrieval API

`getSignalsForWeek(companyId, weekStart, weekEnd)`:

- Filters by `company_id` and `signal_timestamp` within [weekStart, weekEnd].
- Orders by `signal_score` descending.
- Returns `SchedulingSignalRow[]`.

---

## 6. Integration (API only)

Signals are exposed via the service. No modifications to:

- `contentDistributionIntelligence`
- `weeklyScheduleAllocator`
- AI planning prompts

These can later consume signals via `getSignalsForWeek()` and `recordSignal()`.

---

## 7. Example Signal

**Script:** `backend/scripts/storeExampleSchedulingSignal.ts`

```json
{
  "company_id": "00000000-0000-0000-0000-000000000001",
  "signal_type": "industry_trend",
  "signal_source": "news",
  "signal_topic": "AI regulation",
  "signal_score": 0.82,
  "signal_timestamp": "2025-03-07T10:00:00Z",
  "metadata": { "region": "global", "example": true }
}
```

**Run:**
```bash
EXAMPLE_COMPANY_ID=<uuid> npx ts-node -r tsconfig-paths/register backend/scripts/storeExampleSchedulingSignal.ts
```

---

## 8. Confirmation Checklist

| Item | Status |
|------|--------|
| 1. intelligence_signals table created | ✅ `scheduling_intelligence_signals` (Phase 6A signals) |
| 2. signalIntelligenceEngine service implemented | ✅ `recordSignal`, `scoreSignal`, `getSignalsForWeek` in `signalIntelligenceEngine.ts` |
| 3. Scoring logic implemented | ✅ recency × 0.4 + topicRelevance × 0.4 + sourceReliability × 0.2 |
| 4. Retrieval API implemented | ✅ `getSignalsForWeek(companyId, weekStart, weekEnd)` |
| 5. Example signal stored | ✅ Script `storeExampleSchedulingSignal.ts` |

---

## 9. Files Created / Modified

| File | Change |
|------|--------|
| `database/scheduling_intelligence_signals.sql` | **New** — table + indexes |
| `backend/services/signalIntelligenceEngine.ts` | **Modified** — added Phase 6A scheduling signal functions |
| `backend/tests/unit/schedulingSignalIntelligence.test.ts` | **New** — unit tests |
| `backend/scripts/storeExampleSchedulingSignal.ts` | **New** — example signal script |
