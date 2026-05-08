# Repository Output Trust Report

Repository output trust remains PARTIAL. Repository paths no longer create critical propagation findings, but typed repository output cleanup remains high-only debt.

## Counts
- critical unsafe propagation findings: 0
- high unsafe propagation findings: 72716
- critical unsafe source findings still present as source debt: 2358
- high unsafe source findings: 5492
- remaining dangerous unsafe surfaces: 72716

## Validation
- npm run audit:semantic-enforcement: completed; critical findings 0; high findings 475; readiness READY
- npm run check:semantic-enforcement: completed; hard check passed
- npm run audit:canonical-authority: completed; authority readiness READY
- npm run check:mutation-governance: completed; critical mutation findings 0; uncontrolled mutation propagations 0
- npm run check:runtime-cycles: completed; runtimeDependencyCycles 0
- npx tsc --noEmit --pretty false: completed successfully

