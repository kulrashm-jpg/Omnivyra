# Safe Migration Order

1. Freeze reports and warning baselines in architecture-migration/reports.
2. Promote frontend/backend import warnings to CI-visible non-blocking output.
3. Extract shared DTOs and validators into production shared/contracts and shared/schemas.
4. Move frontend imports from backend internals to shared contracts and API clients.
5. Introduce repository implementations behind existing DB behavior.
6. Route scheduling writes through ScheduleRepository and ScheduleCommandService.
7. Route content generation through a single ContentGenerationPipeline facade.
8. Route recommendation snapshots through RecommendationSnapshotRepository.
9. Extract campaign variant adapters and remove variant fields from campaign core contracts.
10. Delete duplicate weekly-structure API helper after all imports resolve to domain/core.
11. Quarantine deprecated routes by classification: DEAD first, INTERNAL_ONLY behind internal router, UNKNOWN after telemetry decision, ACTIVE after replacement.
12. Break dependency cycles by ports/interfaces from outer modules inward.
13. Split oversized files only after ownership boundaries are enforced.
14. Promote warnings to blocking in this order: frontend/backend imports, deprecated routes, duplicate execution owners, direct DB writes, variant contamination, dependency cycles, file size.
