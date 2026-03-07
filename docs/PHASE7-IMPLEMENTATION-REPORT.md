# Phase 7 — Strategic Simulation Engine Implementation Report

**Date:** 2025-03-06  
**Scope:** Strategic simulation layer for impact forecasting and strategy ranking.

---

## 1. Simulation Architecture After Phase 7

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    STRATEGIC SIMULATION ENGINE (Phase 7)                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                       │
│  strategySimulationEngine         scenarioModelEngine                                 │
│  • simulateRecommendationImpact() • modelScenarios()                                  │
│  • Uses historical outcomes       • optimistic / base / pessimistic                  │
│  • simulated_impact_score         • outcome_probability, impact_multiplier          │
│  • expected_outcome_probability       │                                               │
│       │                                │                                              │
│       └────────────────┬──────────────┘                                              │
│                        ▼                                                             │
│  impactForecastEngine            strategyComparisonEngine                             │
│  • predictOutcomeProbability()   • rankStrategies()                                   │
│  • predicted_outcome_probability • ranked_strategies by ranking_score                 │
│  • risk_level (low/medium/high)  • Uses impactForecastEngine                          │
│  • factors                        • getSimulationRuns()                                │
│       │                                │                                              │
│       └────────────────┬──────────────┘                                              │
│                        ▼                                                             │
│  simulationOrchestrationService                                                       │
│  • runFullSimulation()                                                                │
│  • getSimulationRuns()                                                                │
│                        │                                                             │
│                        ▼                                                             │
│  /api/intelligence/simulation (GET, POST)                                             │
│  intelligence_simulation_runs                                                         │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Files Created

| File | Purpose |
|------|---------|
| `database/intelligence_simulation_runs.sql` | Stores simulation run results |
| `backend/services/strategySimulationEngine.ts` | Simulates recommendation impact from historical data |
| `backend/services/scenarioModelEngine.ts` | Models optimistic, base, pessimistic scenarios |
| `backend/services/impactForecastEngine.ts` | Predicts outcome probability per recommendation |
| `backend/services/strategyComparisonEngine.ts` | Ranks strategies by predicted impact |
| `backend/services/simulationOrchestrationService.ts` | Orchestrates all simulation engines |
| `pages/api/intelligence/simulation.ts` | API for simulation runs and history |

---

## 3. Files Modified

**None.** Phase 7 is additive. No changes to Phase 1–6 engines.

---

## 4. Database Migration

### intelligence_simulation_runs

```sql
CREATE TABLE IF NOT EXISTS intelligence_simulation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  run_type TEXT NOT NULL,
  scenario_type TEXT NULL,
  input_recommendation_ids JSONB DEFAULT '[]'::jsonb,
  result_summary JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Indexes: (company_id), (run_type), (company_id, created_at DESC)
```

**Run types:** `impact_simulation`, `scenario_model`, `impact_forecast`, `strategy_comparison`

---

## 5. Capabilities

### Simulate Recommendation Impact

- **Input:** Company ID, optional recommendation IDs
- **Logic:** Uses historical outcomes and feedback per recommendation; falls back to global average
- **Output:** `simulated_impact_score`, `expected_outcome_probability`, `aggregate_impact`

### Predict Outcome Probability

- **Input:** Company ID, optional recommendation IDs
- **Logic:** Combines historical success (50%), confidence (40%), supporting signals (10%)
- **Output:** `predicted_outcome_probability`, `risk_level`, `factors`

### Rank Strategies

- **Input:** Company ID, optional recommendation IDs
- **Logic:** Uses impact forecast; ranking_score = probability × 0.6 + confidence × 0.4
- **Output:** `ranked_strategies` with rank, ranking_score, predicted_impact

### Scenario Modeling

- **Input:** Company ID
- **Logic:** Applies multipliers to base outcome probability
- **Output:** `optimistic` (1.25×), `base` (1.0×), `pessimistic` (0.7×)

---

## 6. API Endpoints

| Method | Query/Body | Purpose |
|--------|------------|---------|
| GET | `?simType=impact` | Run impact simulation |
| GET | `?simType=scenarios` | Model scenarios |
| GET | `?simType=forecast` | Predict outcome probability |
| GET | `?simType=compare` | Rank strategies |
| GET | `?history=true` | List past simulation runs |
| GET | `?runType=X` | Filter runs by type |
| POST | `{ recommendationIds?, persistRuns? }` | Run full simulation suite |

---

## 7. Compatibility Verification

Phase 7 is additive. Reads from:
- `intelligence_recommendations`
- `intelligence_outcomes`
- `recommendation_feedback`

Does not modify signalClusterEngine, companyIntelligenceEngine, strategicThemesEngine, intelligenceLearningEngine, or Phase 6 engines.
