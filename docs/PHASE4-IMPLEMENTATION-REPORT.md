# Phase 4 — Strategic Intelligence System Implementation Report

**Date:** 2025-03-06  
**Scope:** Persistent strategic intelligence — themes, memory, market pulse, competitive intel, playbooks.

---

## 1. Strategic Intelligence Architecture After Phase 4

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STRATEGIC INTELLIGENCE SYSTEM                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  Phase 1–3: signals → correlations → opportunities                          │
│       │                                                                      │
│       ▼                                                                      │
│  strategicThemesEngine                                                        │
│  • Groups opportunities + clusters into themes                               │
│  • Persists to company_strategic_themes                                       │
│       │                                                                      │
│       ├──────────────────────────┬──────────────────────────┐               │
│       ▼                          ▼                          ▼               │
│  marketPulseEngine         competitiveIntelligenceEngine   strategicIntelligenceMemoryService │
│  • acceleration            • product_launch                 • storeStrategicMemory()           │
│  • slowdown                • pricing_shift                  • getStrategicMemoryForCompany()    │
│  • trend_volatility        • strategy_shift                 • strategic_memory table           │
│  • affected_topics         • market_expansion               │               │
│       │                          │                          │               │
│       └──────────────────────────┴──────────────────────────┘               │
│                                      │                                        │
│                                      ▼                                        │
│                       strategicPlaybookEngine                                 │
│                       • content_expansion_playbook                            │
│                       • market_positioning_playbook                          │
│                       • product_opportunity_playbook                         │
│                       • competitive_response_playbook                         │
│                                      │                                        │
│                                      ▼                                        │
│                       /api/intelligence/themes                                │
│                       /api/intelligence/market-pulse                         │
│                       /api/intelligence/competitive                           │
│                       /api/intelligence/playbooks                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Files Created

| File | Purpose |
|------|---------|
| `database/company_strategic_themes.sql` | Themes derived from opportunities |
| `database/strategic_memory.sql` | Long-term intelligence storage |
| `backend/services/strategicThemesEngine.ts` | Groups opportunities into themes |
| `backend/services/strategicIntelligenceMemoryService.ts` | Stores/retrieves strategic memory |
| `backend/services/marketPulseEngine.ts` | Detects acceleration, slowdown, volatility |
| `backend/services/competitiveIntelligenceEngine.ts` | Detects competitor activities |
| `backend/services/strategicPlaybookEngine.ts` | Converts intelligence to playbooks |
| `backend/services/strategicIntelligenceOrchestrationService.ts` | Phase 4 orchestration |
| `pages/api/intelligence/themes.ts` | API: themes |
| `pages/api/intelligence/market-pulse.ts` | API: market pulse |
| `pages/api/intelligence/competitive.ts` | API: competitive intelligence |
| `pages/api/intelligence/playbooks.ts` | API: playbooks |

---

## 3. Files Modified

**None.** Phase 4 is additive. No changes to signalClusterEngine, signalIntelligenceEngine, companyIntelligenceEngine.

**Note:** `strategicIntelligenceMemoryService` is distinct from existing `strategicMemoryService` (campaign snapshots). `strategicThemesEngine` is distinct from existing `strategicThemeEngine` (cluster-based themes).

---

## 4. Database Migrations

### company_strategic_themes

```sql
CREATE TABLE IF NOT EXISTS company_strategic_themes (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL,
  theme_topic TEXT NOT NULL,
  theme_strength NUMERIC NULL,
  supporting_signals JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Indexes:** (company_id), (company_id, theme_strength DESC)

### strategic_memory

```sql
CREATE TABLE IF NOT EXISTS strategic_memory (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL,
  theme_id UUID NULL REFERENCES company_strategic_themes(id) ON DELETE SET NULL,
  memory_type TEXT NOT NULL,
  confidence NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Indexes:** (company_id), (theme_id), (company_id, created_at DESC)

**Run order:** company_strategic_themes first, then strategic_memory.

---

## 5. Theme Generation Logic

- **Input:** opportunities (from Phase 3), insights (trend_clusters from Phase 2)
- **Grouping:** Normalize topic → group by normalized key; aggregate strength from opportunity_score and cluster relevance
- **Output:** theme_topic, theme_strength, supporting_signals
- **Persistence:** Optional `persist=true` → insert into company_strategic_themes

---

## 6. Market Pulse Logic

- **Input:** insights.trend_clusters, correlations
- **Patterns:** acceleration (growth, rise, surge), slowdown (decline, drop), volatility (volatile, shift)
- **Output:** pulse_type, pulse_score, affected_topics
- **Volatility from correlations:** When ≥3 correlation groups exist, add trend_volatility pulse

---

## 7. Competitive Intelligence Logic

- **Input:** insights.competitor_activity, insights.market_shifts
- **Patterns:** product_launch, pricing_shift, strategy_shift, market_expansion
- **Output:** signal_type, confidence, summary, supporting_signals

---

## 8. Playbook Generation Logic

- **Input:** themes, opportunities, marketPulses, competitiveSignals
- **Mapping:**
  - themes (strength ≥ 0.3) → content_expansion_playbook
  - market_acceleration pulse → market_positioning_playbook
  - market_gap opportunity → product_opportunity_playbook
  - product_launch / pricing_shift competitive → competitive_response_playbook
- **Output:** playbook_type, confidence_score, action_summary, supporting_signals

---

## 9. Performance Considerations

| Component | Notes |
|-----------|-------|
| Themes | Depends on getCompanyInsights + getOpportunities; reuses Phase 2/3 caches |
| Market pulse | Single pass over clusters + correlations |
| Competitive | Single pass over competitor_activity + market_shifts |
| Playbooks | Aggregates all; O(themes + opportunities + pulses + competitive) |
| Persist themes | Adds 1 insert per theme batch; use sparingly |

---

## 10. Compatibility Verification

- **strategicThemeEngine** (existing): Unchanged; works with signal_intelligence → strategic_themes
- **strategicMemoryService** (existing): Unchanged; campaign snapshots in strategic_memory_snapshots
- **companyIntelligenceAggregator:** Unchanged; Phase 4 consumes its output
- **opportunityDetectionEngine:** Unchanged; Phase 4 consumes its output
- **signalCorrelationEngine:** Unchanged; Phase 4 consumes its output

Phase 4 is additive; no existing engines were modified.
