# Intelligence Architecture Simplification Report

**Date:** 2025-03-06  
**Scope:** Structural consolidation of the Intelligence Platform from ~35 services to ~12 core services.

---

## 1. Simplified Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         INTELLIGENCE CORE ENGINE (Orchestrator)                          │
│                         backend/services/intelligenceCoreEngine.ts                        │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  runIntelligenceCycle()                                                                  │
│    → ingestionModule.ingestSignals()     [optional]                                       │
│    → analysisModule.analyzeSignals()                                                      │
│    → strategyModule.generateStrategies()                                                 │
│    → learningModule.processLearning()                                                    │
│    → optimizationOrchestrationService.runOptimizationForCompany()  [optional]             │
│    → simulationModule.runSimulations()  [optional]                                       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
         ┌──────────────────────────────┼──────────────────────────────┐
         ▼                              ▼                              ▼
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ INGESTION MODULE    │    │ ANALYSIS MODULE     │    │ STRATEGY MODULE      │
│ ingestionModule     │    │ analysisModule      │    │ strategyModule       │
├─────────────────────┤    ├─────────────────────┤    ├─────────────────────┤
│ • ingestSignals()   │    │ • clusterSignals()  │    │ • generateStrategies │
│ • expand() (query)  │    │ • getInsights()     │    │ • getRecommendations │
│                     │    │ • getCorrelations() │    │ • getOpportunities() │
│                     │    │ • analyzeSignals()  │    │                     │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
         │                              │                              │
         └──────────────────────────────┼──────────────────────────────┘
                                        ▼
┌─────────────────────┐    ┌─────────────────────┐
│ LEARNING MODULE     │    │ SIMULATION MODULE   │
│ learningModule      │    │ simulationModule    │
├─────────────────────┤    ├─────────────────────┤
│ • processLearning() │    │ • runSimulations()  │
│ • recordOutcome()   │    │ • simulateImpact()  │
│ • recordFeedback()  │    │ • modelScenarios()  │
│ • evaluateStrategy  │    │ • predictOutcome()  │
│ • computeWeights    │    │ • rankStrategies()  │
│ • qualityMetrics    │    │ • getSimulationRuns │
└─────────────────────┘    └─────────────────────┘
```

---

## 2. Services Before Refactor

| Category | Services |
|----------|----------|
| Ingestion | externalApiService, intelligenceQueryBuilder, intelligencePollingWorker (logic), signalRelevanceEngine, intelligenceSignalStore |
| Analysis | signalClusterEngine, signalCorrelationEngine, companyIntelligenceEngine, companyIntelligenceAggregator, companyIntelligenceService, companyIntelligenceStore, companyIntelligenceCache |
| Strategy | opportunityDetectionEngine, strategicThemesEngine, marketPulseEngine, competitiveIntelligenceEngine, strategicPlaybookEngine, strategicRecommendationEngine, intelligenceGraphEngine, intelligenceOrchestrationService, strategicIntelligenceOrchestrationService |
| Learning | outcomeTrackingEngine, recommendationFeedbackEngine, intelligenceLearningEngine, themeReinforcementEngine, strategyPerformanceEngine, signalWeightOptimizationEngine, recommendationOptimizationEngine, intelligenceQualityEngine, learningOrchestrationService, recommendationPersistenceService |
| Optimization | optimizationOrchestrationService, themeEvolutionEngine |
| Simulation | strategySimulationEngine, scenarioModelEngine, impactForecastEngine, strategyComparisonEngine, simulationOrchestrationService |

**Approximate count:** ~35 services/engines

---

## 3. Services After Refactor

| Type | Services |
|------|----------|
| **Modules (5)** | intelligenceIngestionModule, intelligenceAnalysisModule, intelligenceStrategyModule, intelligenceLearningModule, intelligenceSimulationModule |
| **Orchestrator (1)** | intelligenceCoreEngine |
| **Optimization** | optimizationOrchestrationService (unchanged, called by core) |
| **Supporting** | recommendationPersistenceService, strategicIntelligenceMemoryService (unchanged) |
| **Worker** | intelligencePollingWorker (now delegates to ingestion module) |

**Core entry points:** 6 (5 modules + 1 orchestrator)  
**Total intelligence-related:** ~10–12 services as primary entry points

---

## 4. Modules Created

| Module | Path | Engines Wrapped |
|--------|------|-----------------|
| Intelligence Ingestion Module | `backend/services/intelligenceIngestionModule.ts` | externalApiService, intelligenceQueryBuilder, intelligenceSignalStore, signalRelevanceEngine (via store), companyIntelligenceStore (processInsertedSignals) |
| Intelligence Analysis Module | `backend/services/intelligenceAnalysisModule.ts` | signalClusterEngine, signalCorrelationEngine, companyIntelligenceAggregator, companyIntelligenceService |
| Intelligence Strategy Module | `backend/services/intelligenceStrategyModule.ts` | opportunityDetectionEngine, strategicThemesEngine, marketPulseEngine, competitiveIntelligenceEngine, strategicPlaybookEngine, strategicRecommendationEngine, intelligenceGraphEngine, signalCorrelationEngine |
| Intelligence Learning Module | `backend/services/intelligenceLearningModule.ts` | outcomeTrackingEngine, recommendationFeedbackEngine, intelligenceLearningEngine, themeReinforcementEngine, strategyPerformanceEngine, signalWeightOptimizationEngine, recommendationOptimizationEngine, intelligenceQualityEngine, learningOrchestrationService |
| Intelligence Simulation Module | `backend/services/intelligenceSimulationModule.ts` | strategySimulationEngine, scenarioModelEngine, impactForecastEngine, strategyComparisonEngine |

---

## 5. Engines Moved Into Each Module

### Ingestion Module
- externalApiService (fetchSingleSourceWithQueryBuilder, getExternalApiSourceById, addSignalsGenerated, checkCompanyApiLimitsForPolling)
- intelligenceQueryBuilder (expand)
- intelligenceSignalStore (insertFromTrendApiResults)
- signalRelevanceEngine (used inside intelligenceSignalStore)
- companyIntelligenceStore (processInsertedSignalsForCompany)

### Analysis Module
- signalClusterEngine (clusterRecentSignals)
- signalCorrelationEngine (detectCorrelations)
- companyIntelligenceAggregator (aggregateCompanyIntelligence)
- companyIntelligenceService (getCompanyInsights, getRecentCompanySignals)

### Strategy Module
- opportunityDetectionEngine (detectOpportunities)
- strategicThemesEngine (groupOpportunitiesIntoThemes, persistThemes)
- marketPulseEngine (detectMarketPulse)
- competitiveIntelligenceEngine (detectCompetitiveIntelligence)
- strategicPlaybookEngine (generatePlaybooks)
- strategicRecommendationEngine (opportunitiesToRecommendations)
- intelligenceGraphEngine (buildGraphForCompanySignals)
- signalCorrelationEngine (detectCorrelations)

### Learning Module
- outcomeTrackingEngine
- recommendationFeedbackEngine
- intelligenceLearningEngine
- themeReinforcementEngine
- strategyPerformanceEngine
- signalWeightOptimizationEngine
- recommendationOptimizationEngine
- intelligenceQualityEngine
- learningOrchestrationService

### Simulation Module
- strategySimulationEngine
- scenarioModelEngine
- impactForecastEngine
- strategyComparisonEngine

---

## 6. Orchestrator Implementation

**intelligenceCoreEngine** provides:

- `runIntelligenceCycle(options)` — runs the full pipeline with configurable phases
- Phase options: `runIngestion`, `runAnalysis`, `runStrategy`, `runLearning`, `runOptimization`, `runSimulation`
- Re-exports: `ingestSignals`, `analyzeSignals`, `getInsights`, `clusterSignals`, `getCorrelations`, `generateStrategies`, `getRecommendations`, `getOpportunities`, `processLearning`, `evaluateStrategyPerformance`, `computeAndPersistQualityMetrics`, `canRunOptimization`, `runOptimizationForCompany`, `runSimulations`, `getSimulationRuns`

---

## 7. API Changes

| Endpoint | Change |
|----------|--------|
| `POST /api/intelligence/run` | **New** — runs full cycle via intelligenceCoreEngine |
| `GET /api/intelligence/metrics` | **New** — strategy performance + quality metrics |
| `GET /api/intelligence/recommendations` | Unchanged — still uses intelligenceOrchestrationService |
| `GET /api/intelligence/simulation` | Unchanged — uses simulationOrchestrationService (can switch to intelligenceSimulationModule) |
| `GET /api/intelligence/learning` | Unchanged |
| `GET /api/intelligence/outcomes` | Unchanged |
| `GET /api/intelligence/feedback` | Unchanged |
| `GET /api/intelligence/optimization` | Unchanged |
| Existing themes, opportunities, etc. | Unchanged |

**Backward compatibility:** All existing endpoints continue to work. New endpoints use the consolidated architecture.

---

## 8. Compatibility Verification

- **Existing engines:** Not deleted; imported and used by modules
- **Existing APIs:** Behavior unchanged
- **intelligencePollingWorker:** Now calls `ingestSignals` from ingestion module
- **intelligenceOrchestrationService:** Still used by recommendations API (can be migrated to strategy module)
- **strategicIntelligenceOrchestrationService:** Still used by themes/playbooks APIs (can be migrated)

---

## 9. Performance Impact

| Area | Impact |
|------|--------|
| Ingestion | No change — same logic, now behind module |
| Analysis | No change — same queries |
| Strategy | No change — same orchestration |
| Learning | No change |
| Simulation | Throttle added: max 10 runs/hour per company |
| Optimization | Existing 6-hour throttle unchanged |
| API | Minimal — one extra hop through module/orchestrator |

---

## 10. Safeguards Implemented

| Safeguard | Implementation |
|-----------|----------------|
| Optimization stability | `max_weight_change = ±0.15` in signalWeightOptimizationEngine (unchanged) |
| Simulation cost | `max_simulation_runs_per_hour = 10` in intelligenceSimulationModule |
| Service boundary | Cross-module calls go through intelligenceCoreEngine |
| Backward compatibility | Existing APIs unchanged; adapter wrappers available |
| Engine isolation | Engines not modified; modules delegate to them |

---

## 11. Risks Discovered

1. **Migration path:** Some callers still use intelligenceOrchestrationService and strategicIntelligenceOrchestrationService directly. A full migration would route all through intelligenceCoreEngine.
2. **Worker dependency:** intelligencePollingWorker now depends on intelligenceIngestionModule. If the module is removed or refactored, the worker must be updated.
3. **Duplicate orchestration:** strategicIntelligenceOrchestrationService and intelligenceOrchestrationService overlap with intelligenceStrategyModule. Consider deprecating the older orchestrators once clients migrate.
4. **Learning module breadth:** The learning module aggregates many engines; future changes may require careful scoping.
