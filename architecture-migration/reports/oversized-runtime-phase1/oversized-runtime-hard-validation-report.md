# Oversized Runtime Hard Validation Report

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


## Validation
- npm run audit:runtime-cycles: completed; mixedRuntimeOversizedFiles 96; runtimeDependencyCycles 0
- npm run check:runtime-cycles: completed; runtimeDependencyCycles 0
- npm run check:semantic-enforcement: completed; critical findings 0; high findings 475
- npm run check:mutation-governance: completed; critical mutation findings 0; uncontrolled mutation propagations 0
- npm run audit:canonical-authority: completed; finalSemanticEnforcementReadiness READY
- npx tsc --noEmit --pretty false: completed successfully
