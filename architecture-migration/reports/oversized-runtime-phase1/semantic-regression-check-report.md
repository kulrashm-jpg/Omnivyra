# Semantic Regression Check Report

Semantic trust regression: NONE.

Mutation governance regression: NONE.

Unsafe propagation regression: NONE.

Authority-lineage regression: NONE.

Runtime cycles: 0.

Typecheck errors: 0.

- npm run audit:runtime-cycles: completed; mixedRuntimeOversizedFiles 96; runtimeDependencyCycles 0
- npm run check:runtime-cycles: completed; runtimeDependencyCycles 0
- npm run check:semantic-enforcement: completed; critical findings 0; high findings 475
- npm run check:mutation-governance: completed; critical mutation findings 0; uncontrolled mutation propagations 0
- npm run audit:canonical-authority: completed; finalSemanticEnforcementReadiness READY
- npx tsc --noEmit --pretty false: completed successfully
