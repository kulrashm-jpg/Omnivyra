# SNAPSHOT_ACTIVATION_PRECHECK.md

Phase 13B · Phase 2 — pre-apply validation that the snapshot code compiles against the
migration schema.

## Code ↔ schema alignment

| Service | Reads/writes | Columns used | Matches migration? |
|---|---|---|---|
| `customerReadinessSnapshotService` | INSERT (upsert) | company_id, taken_at, snapshot_date, tenant_status, overall_readiness_score, readiness_bucket, priority_score, priority_tier, opportunity_count, 8×`*_ready`, snapshot_version | ✅ exact |
| `customerEvolutionService.loadReadinessHistory` | SELECT | company_id, taken_at, overall_readiness_score, readiness_bucket, tenant_status, opportunity_count, priority_tier, 8×`*_ready` | ✅ subset of schema |
| `scripts/customer-readiness-snapshot.ts` | calls generator | — | ✅ |

Idempotency contract: upsert `onConflict: 'company_id,snapshot_date'` ↔ migration
`UNIQUE INDEX idx_crs_company_day (company_id, snapshot_date)`. ✅ aligned.

## Compilation

`tsc --noEmit` (full project) → **0 errors**. The three services + the daily job + the
evolution loader all type-check against the schema shape.

## Verdict

**Clear to apply.** Code and schema are aligned; apply is idempotent and reversible.
