# Phase-4 Signal Prioritization and Storage Alignment — Implementation Report

---

## 1. Database Schema Changes

**File:** `database/company_intelligence_signals_phase4.sql`

```sql
ALTER TABLE company_intelligence_signals
  ADD COLUMN IF NOT EXISTS signal_score NUMERIC NULL;

ALTER TABLE company_intelligence_signals
  ADD COLUMN IF NOT EXISTS priority_level TEXT NULL;

ALTER TABLE company_intelligence_signals
  ADD COLUMN IF NOT EXISTS matched_topics TEXT[] NULL;

ALTER TABLE company_intelligence_signals
  ADD COLUMN IF NOT EXISTS matched_competitors TEXT[] NULL;

ALTER TABLE company_intelligence_signals
  ADD COLUMN IF NOT EXISTS matched_regions TEXT[] NULL;

CREATE INDEX IF NOT EXISTS index_company_intelligence_signals_company_priority
  ON company_intelligence_signals (company_id, priority_level)
  WHERE priority_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS index_company_intelligence_signals_company_signal_score
  ON company_intelligence_signals (company_id, signal_score DESC NULLS LAST);
```

**Existing columns retained:** id, company_id, signal_id, relevance_score, impact_score, signal_type, created_at, UNIQUE (company_id, signal_id).

---

## 2. Fields Added to company_intelligence_signals

| Column | Type | Nullable |
|--------|------|----------|
| signal_score | NUMERIC | YES |
| priority_level | TEXT | YES |
| matched_topics | TEXT[] | YES |
| matched_competitors | TEXT[] | YES |
| matched_regions | TEXT[] | YES |

---

## 3. computeSignalPriority Implementation

**File:** `backend/services/companySignalRankingEngine.ts`

```typescript
export type SignalScoreInputs = {
  momentum_score: number;
  topic_match: boolean;
};

export function computeSignalPriority(inputs: SignalScoreInputs): 'HIGH' | 'MEDIUM' | 'LOW' {
  const { momentum_score, topic_match } = inputs;
  if (momentum_score > 0.7 && topic_match) return 'HIGH';
  if (momentum_score > 0.5) return 'MEDIUM';
  return 'LOW';
}
```

**Rules:**
- HIGH: momentum_score > 0.7 AND topic_match = true
- MEDIUM: momentum_score > 0.5
- LOW: all other signals

---

## 4. Updated insertRankedCompanyIntelligenceSignals Logic

**File:** `backend/services/companyIntelligenceStore.ts`

**Per-row logic:**
1. Compute `priority_level` via `computeSignalPriority({ momentum_score: r.momentum_score, topic_match: r.topic_match })`
2. Map empty arrays to null for matched_topics, matched_competitors, matched_regions
3. Build row: company_id, signal_id, signal_score, priority_level, matched_topics, matched_competitors, matched_regions, relevance_score, impact_score, signal_type, created_at
4. Upsert with onConflict: 'company_id,signal_id', ignoreDuplicates: true

**Import:** `computeSignalPriority` from `companySignalRankingEngine`.

---

## 5. Stored Row Structure

| Field | Source |
|-------|--------|
| company_id | Parameter |
| signal_id | RankedSignalOutput.signal_id |
| signal_score | RankedSignalOutput.signal_score |
| priority_level | computeSignalPriority(momentum_score, topic_match) |
| matched_topics | RankedSignalOutput.matched_topics (or null if empty) |
| matched_competitors | RankedSignalOutput.matched_competitors (or null if empty) |
| matched_regions | RankedSignalOutput.matched_regions (or null if empty) |
| relevance_score | RankedSignalOutput.signal_score |
| impact_score | RankedSignalOutput.signal_score |
| signal_type | inferSignalTypeFromRanked(r) |
| created_at | new Date().toISOString() |

---

## 6. Final Phase-4 Execution Flow

```
intelligence_signals
  → companySignalFilteringEngine.filterSignalsForCompany
  → companySignalRankingEngine.rankSignalsForCompany
  → computeSignalPriority (per ranked signal)
  → insertRankedCompanyIntelligenceSignals
  → company_intelligence_signals
```

**Entry point:** `processInsertedSignalsForCompany(companyId, insertedSignalIds)` in `companyIntelligenceStore.ts`.
