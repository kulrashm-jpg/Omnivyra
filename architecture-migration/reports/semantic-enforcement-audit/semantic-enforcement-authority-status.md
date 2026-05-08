# Semantic Enforcement Authority Status

Semantic enforcement status: BYPASSABLE

## Current Live Signals
- frontend/backend imports: 0
- variant contamination: 0
- deprecated routes: 0
- duplicate orchestration violations detected: 0
- runtime DB write risks: 600
- runtime cycles: 18
- P0 unsafe any propagation: 6039
- mixed runtime oversized files: 234

## Authority Finding
Current duplicate-owner enforcement is AST-assisted but symbol-list based. It is not semantically resolved. It does not trace aliases, re-export chains, dynamic imports, queue dispatch to worker processor, callback composition, factories, nested private coordinators, or runtime fallback paths.

## Stale Baseline Findings
- runtimeDbWriteRisks: baseline=620 current=600
- trueDuplicateOrchestrationOwners: baseline=7 current=0
- criticalUnsafeLeaks: baseline=6269 current=6256
- mixedRuntimeOversizedFiles: baseline=232 current=234
- p0.directDbWritesOutsideRepositories: baseline=620 current=600
- p0.duplicateOrchestrationOwners: baseline=7 current=0
- p0.unsafeAnyPropagation: baseline=6031 current=6039

## Verdict
Current enforcement system is bypassable. It is useful for broad regression alarms but cannot be treated as the final authority for stabilization readiness.
