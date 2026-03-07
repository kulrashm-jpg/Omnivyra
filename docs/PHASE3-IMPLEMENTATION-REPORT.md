# Phase 3 — Intelligence Orchestration Layer Implementation Report

**Date:** 2025-03-06  
**Scope:** Cross-signal intelligence orchestration — correlation, opportunity detection, strategic recommendations.

---

## 1. Architecture After Phase 3

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    INTELLIGENCE ORCHESTRATION LAYER                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Global signals (intelligence_signals)                                        │
│       │                                                                      │
│       ▼                                                                      │
│  Company signals (company_intelligence_signals) — Phase 2                     │
│       │                                                                      │
│       ├──────────────────────────────────────────────────────────────────┐   │
│       │                                                                  │   │
│       ▼                                                                  ▼   │
│  intelligenceGraphEngine                                          signalCorrelationEngine │
│  • topic_similarity                                               • topic_similarity       │
│  • competitor_involvement                                         • temporal_proximity     │
│  • market_shift_linkage                                           • competitor_overlap     │
│  • customer_trend_linkage                                         • shared_entities       │
│       │                                                                  │   │
│       ▼                                                                  ▼   │
│  intelligence_graph_edges                                          CorrelationResult[]    │
│       │                                                                  │   │
│       └──────────────────────────────┬───────────────────────────────────┘   │
│                                      ▼                                       │
│                       opportunityDetectionEngine                              │
│                       • emerging_trend, competitor_weakness                    │
│                       • market_gap, customer_pain_signal                       │
│                                      │                                        │
│                                      ▼                                        │
│                       strategicRecommendationEngine                           │
│                       • content_opportunity, product_opportunity               │
│                       • marketing_opportunity, competitive_opportunity         │
│                                      │                                        │
│                                      ▼                                        │
│                       /api/intelligence/*                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Files Created

| File | Purpose |
|------|---------|
| `database/intelligence_graph_edges.sql` | Migration for graph edges table |
| `backend/services/intelligenceGraphEngine.ts` | Builds signal relationships, stores edges |
| `backend/services/signalCorrelationEngine.ts` | Detects correlations between signals |
| `backend/services/opportunityDetectionEngine.ts` | Detects opportunities from insights + graph |
| `backend/services/strategicRecommendationEngine.ts` | Converts opportunities → recommendations |
| `backend/services/intelligenceOrchestrationService.ts` | Orchestrates graph, correlations, opportunities |
| `pages/api/intelligence/opportunities.ts` | API: opportunities |
| `pages/api/intelligence/recommendations.ts` | API: recommendations |
| `pages/api/intelligence/correlations.ts` | API: correlations |

---

## 3. Files Modified

**None.** Phase 3 is fully additive. No changes to:
- signalClusterEngine
- signalIntelligenceEngine
- companyIntelligenceEngine

---

## 4. Database Migrations

### intelligence_graph_edges

```sql
CREATE TABLE IF NOT EXISTS intelligence_graph_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_signal_id UUID NOT NULL REFERENCES intelligence_signals(id) ON DELETE CASCADE,
  target_signal_id UUID NOT NULL REFERENCES intelligence_signals(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,
  edge_strength NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (source_signal_id != target_signal_id)
);
```

**Indexes:**
- `index_intelligence_graph_edges_source` ON (source_signal_id)
- `index_intelligence_graph_edges_target` ON (target_signal_id)
- `index_intelligence_graph_edges_type` ON (edge_type)

**Constraint:** `UNIQUE (source_signal_id, target_signal_id, edge_type)`

**Run after:** `intelligence_signals` must exist.

---

## 5. Graph Architecture

**Nodes:** intelligence_signals (referenced by source_signal_id, target_signal_id)

**Edge types:**
| Type | Trigger |
|------|---------|
| topic_similarity | Jaccard similarity ≥ 0.25 |
| competitor_involvement | Both topics match competitor pattern |
| market_shift_linkage | Both topics match market/shift pattern |
| customer_trend_linkage | Both topics match customer pattern |

**Build:** `buildGraphForCompanySignals(companyId, windowHours)` fetches company signals, computes edges, upserts to DB.

**Deduplication:** One edge per (source, target, edge_type).

---

## 6. Correlation Detection Logic

| Correlation type | Criteria | Score |
|-------------------|----------|-------|
| topic_similarity | Token Jaccard ≥ 0.2 | Jaccard value |
| temporal_proximity | Signals within 24h + some topic overlap | Blended temporal + topic |
| competitor_overlap | Both topics mention competitor | 0.6 |

**Source:** `signalCorrelationEngine.detectCorrelations(companyId, windowHours)` — uses `tokenizeTopic` and `tokenSimilarity` from signalClusterEngine (read-only).

---

## 7. Opportunity Detection Logic

| Opportunity type | Source | Criteria |
|------------------|--------|----------|
| emerging_trend | trend_clusters | signal_count ≥ 3, avg_relevance ≥ 0.4, topic matches emerging pattern |
| competitor_weakness | competitor_activity | Topic matches weakness pattern |
| market_gap | market_shifts | Topic matches gap pattern, or avg_impact ≥ 0.5 and count ≥ 2 |
| customer_pain_signal | customer_sentiment | Topic matches pain pattern, or sentiment_hint = negative |
| market_gap (graph) | intelligence_graph_edges | market_shift_linkage edges with strength ≥ 0.5 |

---

## 8. Recommendation Generation Logic

| Opportunity type | Recommendation type | Action focus |
|------------------|---------------------|--------------|
| emerging_trend | content_opportunity | Create content on emerging trend |
| competitor_weakness | competitive_opportunity | Leverage in positioning |
| market_gap | product_opportunity | Evaluate product/feature opportunity |
| customer_pain_signal | marketing_opportunity | Develop marketing angle |

**Confidence:** `min(1, opportunity_score * 0.9 + 0.1)`

---

## 9. Performance Considerations

| Component | Notes |
|-----------|-------|
| Graph build | O(n²) over signals in window; use window ≤ 24h for company signals |
| Correlation | O(n²) pairs; capped at 100 pairs per type |
| Opportunity | O(clusters + competitors + shifts + sentiment + edges) |
| Recommendations | O(opportunities); simple mapping |

**Recommendation:** Run `buildGraphForCompanySignals` via cron (e.g. hourly) rather than on every API request; use `?buildGraph=true` only when explicitly refreshing.

---

## 10. Compatibility Verification

- **signalClusterEngine:** Unchanged; `signalCorrelationEngine` imports `tokenizeTopic`, `tokenSimilarity` (read-only).
- **signalIntelligenceEngine:** Unchanged.
- **companyIntelligenceEngine:** Unchanged.
- **companyIntelligenceAggregator:** Unchanged; `opportunityDetectionEngine` consumes its output type.
- **companyIntelligenceService:** Unchanged; `intelligenceOrchestrationService` calls `getCompanyInsights`.

Phase 3 is additive; no existing services were modified.
