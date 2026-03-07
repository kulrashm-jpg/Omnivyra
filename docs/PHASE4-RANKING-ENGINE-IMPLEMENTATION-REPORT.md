# Phase-4 Company Signal Ranking Engine — Implementation Report

---

## 1. File Created

| File | Path |
|------|------|
| Company Signal Ranking Engine | `backend/services/companySignalRankingEngine.ts` |

---

## 2. Exported Methods

| Method | Signature | Purpose |
|--------|-----------|---------|
| `computeRecencyScore` | `(createdAt: string \| Date \| null \| undefined) => number` | Compute recency score from signal age |
| `computeSignalScore` | `(filteredSignal: FilteredSignalLike, signalIntelligence: SignalIntelligenceRow \| null) => number` | Compute combined signal_score for one signal |
| `rankSignalsForCompany` | `(companyId: string, filteredSignals: FilteredSignalWithEvaluation[]) => Promise<RankedSignalOutput[]>` | Main service: rank and sort by signal_score DESC |

**Exported types:**
- `SignalIntelligenceRow`
- `RankedSignalOutput`

---

## 3. Scoring Formula

```
signal_score = 
  WEIGHT_MOMENTUM * momentumScore +
  WEIGHT_TOPIC_MATCH * topicMatchScore +
  WEIGHT_COMPETITOR_MATCH * competitorMatchScore +
  WEIGHT_REGION_MATCH * regionMatchScore +
  WEIGHT_RECENCY * recencyScore
```

**Weights (constants):**

| Factor | Weight |
|--------|--------|
| momentum_score | 0.35 |
| topic_match | 0.20 |
| competitor_match | 0.15 |
| region_match | 0.10 |
| recency | 0.20 |

**Factor contributions:**
- momentumScore: [0, 1] from signal_intelligence.momentum_score or fallback (velocity/10 * 0.5 + volume/100 * 0.5)
- topicMatchScore: 1 if topic_match else 0
- competitorMatchScore: 1 if competitor_match else 0
- regionMatchScore: 1 if region_match else 0
- recencyScore: from `computeRecencyScore`

**Final:** Clamped to [0, 1], rounded to 4 decimals.

---

## 4. Recency Calculation

| Age | Score |
|-----|-------|
| 0–24 hours | 1.0 |
| 1–3 days | 0.8 |
| 3–7 days | 0.6 |
| 7–14 days | 0.4 |
| >14 days | 0.2 |

**Input:** `created_at` (preferred) or `detected_at`.  
**Computation:** `ageHours = (now - then) / (1000 * 60 * 60)`.

---

## 5. signal_intelligence Usage

| Source | Usage |
|--------|--------|
| intelligence_signals | id, cluster_id, detected_at, created_at |
| signal_intelligence | id, cluster_id, momentum_score, signal_count |

**Lookup:** `intelligence_signals.cluster_id` → `signal_intelligence.cluster_id`.

**momentum_score:** When present and valid, used as momentum factor. Otherwise fallback from `normalized_payload.velocity` and `normalized_payload.volume`.

**Fallback when signal_intelligence is missing:** `momentumScore = min(1, (velocity/10)*0.5 + (volume/100)*0.5)`.

**volume_score, confidence_score:** Not in signal_intelligence schema; not used.

---

## 6. Integration Changes in processInsertedSignalsForCompany

**File:** `backend/services/companyIntelligenceStore.ts`

**Flow before:**
```
fetchSignalsByIds → filterSignalsForCompany → loadCompanyContextForIntelligence → transformToCompanySignals → insertCompanyIntelligenceSignals
```

**Flow after:**
```
fetchSignalsByIds → filterSignalsForCompany → rankSignalsForCompany → insertRankedCompanyIntelligenceSignals
```

**New function:** `insertRankedCompanyIntelligenceSignals(companyId, ranked)`

**Removed:** `loadCompanyContextForIntelligence`, `transformToCompanySignals`, `insertCompanyIntelligenceSignals` for this flow.

**insertRankedCompanyIntelligenceSignals:**
- Maps `signal_score` → `relevance_score`
- Maps `signal_score` → `impact_score`
- Infers `signal_type` from evaluation: competitor_match → `competitor_activity`; region_match + topic_match → `market_shift`; else `trend`

---

## 7. Ranked Output Structure

```typescript
{
  signal_id: string;
  signal_score: number;
  matched_topics: string[];
  matched_competitors: string[];
  matched_regions: string[];
  topic_match: boolean;
  competitor_match: boolean;
  region_match: boolean;
}
```

**Sort:** `signal_score DESC`.
