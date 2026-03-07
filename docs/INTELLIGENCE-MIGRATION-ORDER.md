# Intelligence Platform — Migration Order

Required tables and recommended application order.

## Core Dependencies

1. **companies** — Base table
2. **external_api_sources** — Required for intelligence_signals FK
3. **intelligence_signals** — Central signal store
4. **signal_clusters** — Clustering metadata
5. **company_intelligence_signals** — Company-specific signals (references intelligence_signals)
6. **intelligence_recommendations** — Persisted recommendations
7. **intelligence_outcomes** — Outcome tracking
8. **recommendation_feedback** — Feedback (references intelligence_recommendations)
9. **company_strategic_themes** — Themes
10. **strategic_memory** — Strategic memory (optional: theme_id refs company_strategic_themes)
11. **signal_intelligence** — Optional; references signal_clusters
12. **intelligence_graph_edges** — Optional
13. **intelligence_optimization_metrics** — Phase 6 optimization
14. **theme_evolution_schema** — Adds archived_at to company_strategic_themes
15. **intelligence_simulation_runs** — Phase 7 simulation
16. **intelligence_execution_metrics** — Execution control
17. **company_execution_priority** — Execution control
18. **intelligence_execution_logs** — Execution control
19. **strategic_memory_deduplication** — After strategic_memory
20. **intelligence_recommendations** — Before intelligence_outcomes, recommendation_feedback

## Minimal Run Order

```
1. companies
2. external_api_sources (external-api-sources.sql)
3. intelligence_signals
4. signal_clusters
5. company_intelligence_signals
6. intelligence_recommendations
7. intelligence_outcomes
8. recommendation_feedback
9. company_strategic_themes
10. strategic_memory
11. intelligence_optimization_metrics
12. theme_evolution_schema
13. intelligence_simulation_runs
14. intelligence_execution_metrics
15. company_execution_priority
16. intelligence_execution_logs
17. strategic_memory_deduplication (optional)
```

## Seed Data

After migrations: `intelligence_seed_data.sql` (3 companies, 5 signals, company links).
