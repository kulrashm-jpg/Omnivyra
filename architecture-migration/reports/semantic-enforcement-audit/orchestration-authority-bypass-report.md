# Orchestration Authority Bypass Report

Orchestration authority status: PARTIAL

## Detection Mode
- Symbol-only: yes
- Filename-only: partial, through canonical owner substring checks
- Export-name-only: partial, because function names and variable names are checked
- Semantically resolved: no

## Detected Duplicate Owners
- none

## Ownership Classes Seen
- canonical-owner: 8
- queue-entrypoint: 1
- adapter/delegator: 1

## Unresolved Execution Roots
- pages/api/bolt/execute.ts: queue.add plus direct executeBoltPipeline fallback
- backend/workers/main.ts: direct Worker construction and processor registration
- backend/queue/jobProcessors/contentGenerationProcessor.ts: local buildPlatformVariantsFromMaster execution path
- lib/post/runPostGeneration.ts and lib/thread/runThreadGeneration.ts: direct content generation execution roots
- pages/api/activity-workspace/content.ts: API-owned content generation call path
- pages/api/recommendations/*.ts: API recommendation generation roots
- pages/api/social/post.ts and pages/api/schedule/posts.ts: legacy scheduling creation roots
- backend/services/recommendationEngine.ts and backend/services/recommendationEngine/engine.ts: dual canonical-looking recommendation exports
- backend/services/structuredPlanScheduler.ts: queue path, inline block processor fallback, legacy path fallback
- backend/scheduler/cron.ts: broad scheduled worker dispatcher authority

## False-Negative Ownership Cases
- Renamed coordinators whose names are absent from executionDomains.symbols.
- Local nested coordinator functions inside services and processors.
- Queue processors with direct orchestration classified as queue-entrypoint, not duplicate owner.
- API handlers with embedded orchestration classified as api-entrypoint, not duplicate owner.
- Fallback execution paths inside canonical-looking services not treated as separate owners.
- Dynamic imports from API routes not resolved to ownership authority.
- Dual recommendation exports remain ambiguous: service and sub-engine can both appear canonical.

## Ambiguities
- A1: pages/api/bolt/execute.ts: queue.add plus direct executeBoltPipeline fallback
- A2: backend/workers/main.ts: direct Worker construction and processor registration
- A3: backend/queue/jobProcessors/contentGenerationProcessor.ts: local buildPlatformVariantsFromMaster execution path
- A4: lib/post/runPostGeneration.ts and lib/thread/runThreadGeneration.ts: direct content generation execution roots
- A5: pages/api/activity-workspace/content.ts: API-owned content generation call path
- A6: pages/api/recommendations/*.ts: API recommendation generation roots
- A7: pages/api/social/post.ts and pages/api/schedule/posts.ts: legacy scheduling creation roots
- A8: backend/services/recommendationEngine.ts and backend/services/recommendationEngine/engine.ts: dual canonical-looking recommendation exports
- A9: backend/services/structuredPlanScheduler.ts: queue path, inline block processor fallback, legacy path fallback
- A10: backend/scheduler/cron.ts: broad scheduled worker dispatcher authority

Verdict: no detected duplicate owner, but semantic ownership is not proven.
