# Stable Baseline Restoration Plan

1. Restore audit baseline inputs from the last stable phase6/p0-risk-sprint report set before evaluating regressions.
2. Restore frontend/backend boundary state first: compare current frontend-backend-imports.json against phase6/frontend-backend-imports.json and reapply the shared-contract import replacements that yielded zero records.
3. Restore variant-contamination state: compare current variant-contamination.json against phase6/variant-contamination.json and reapply the bolt/creator metadata wrapper extraction that yielded zero records.
4. Preserve duplicate-owner reduction by keeping implementation-name bodies plus stable export aliases, or apply the same owner-symbol removal after the baseline is restored.
5. Restore repository-owned mutations from the stable phase: reintroduce repository layer files and route migrated calls back through repositories before attempting new DB migration.
6. Restore runtime cycle baseline: reapply previous cycle-breaking extractions before adding new aliases or barrel exports.
7. Run stabilization-audit and ownership-risk-audit after each restoration group; do not run further migrations until frontend/backend imports and variant contamination are back at zero.
8. Re-run typecheck with preserved public type exports before changing additional dependency edges.
