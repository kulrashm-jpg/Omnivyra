# Mixed Runtime Ownership Extraction Report

## Completed
- Extracted company execution config persistence and row mapping from backend/services/intentExecutionService.ts into backend/repositories/intentExecutionConfigRepository.ts.
- Removed local service-role Supabase client ownership from intentExecutionService.ts.
- Preserved service exports for CompanyExecutionFlags through type re-export.

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

