# Semantic Runtime Co-location Enforcement Report

## Added
- Oversized audit now uses dangerous co-location flags: mixedOrchestrationPersistence, mixedQueueMutation, mixedAuthorityExecution.
- Render-only UI, type/schema aggregation, scripts, and stable isolated oversized files are excluded from dangerous mixed-runtime classification.
- Enforcement is semantic co-location based, not LOC-only.

## Counts
- dangerous oversized runtime regions: 96
- mixed orchestration/persistence regions: 62
- mixed queue/scheduler/mutation regions: 42
- mixed authority/execution regions: 83
- duplicate execution ownership: 0
- runtime cycles: 0
- critical unsafe propagation findings: 0
- high unsafe propagation findings: 475
- typecheck errors: 0

