# Runtime Dependency Report — `database/` references

Scope: production runtime code paths (`backend/**`, `pages/**`) and dev scripts that *instruct operators to run* `database/*.sql` files manually.

## Hard runtime-fallback references (BLOCKER for moving `database/`)

| File | Line | Referenced SQL | Context |
|---|---|---|---|
| `backend/services/externalApiHealthService.ts` | 149 | `database/external_api_health.sql` | "table not found. Run … to create it." (warn log) |
| `backend/services/externalApi/execution.ts` | 438 | `database/external_api_health.sql` | same |
| `backend/services/externalApi/dbHelpers.ts` | 77 | `database/external_api_health.sql` | same |
| `backend/services/externalApi/dbHelpers.ts` | 207 | `database/external-api-usage.sql` | "table not found. Run …" |
| `backend/services/externalApi/dbHelpers.ts` | 269 | `database/external_api_usage_signals_generated.sql` | "column missing. Run …" |
| `backend/services/externalApi/usageLogging.ts` | 107 | `database/external-api-usage.sql` | warn log fallback |
| `backend/services/externalApi/usageLogging.ts` | 181 | `database/external_api_usage_signals_generated.sql` | warn log fallback |
| `backend/services/externalApi/usageLogging.ts` | 212 | `database/external_api_usage_signals_generated.sql` | inline message |
| `backend/services/externalApi/usageLogging.ts` | 213 | `database/external-api-usage.sql` | inline message |
| `backend/services/GovernanceAuditService.ts` | 94 | `database/governance_audit_runs.sql` | "table not found. Run …" |
| `backend/services/signalClusterEngine.ts` | 302 | `database/signal_clusters_source_api_id.sql`, `database/add_signal_embeddings.sql` | "column missing. Run …" |
| `backend/constants/platforms.ts` | 4 | `database/platform_registry.sql` | doc comment "Aligned with platform_registry table" |
| `backend/scripts/seedPlatformOauthConfigsFromEnv.ts` | 4 | `database/platform_oauth_configs.sql` | "Run after: …" header |
| `backend/scripts/storeExampleSchedulingSignal.ts` | 3 | `database/scheduling_intelligence_signals.sql` | "Run after migration: …" header |

## User-facing references

| File | Line | Referenced SQL |
|---|---|---|
| `pages/admin/blog/index.tsx` | 143 | `database/public_blogs.sql` (rendered to admin user as remediation step) |

## Build artifact references (compiled mirrors of the above — ignore, will regenerate)
- `.next/dev/server/...` (multiple). Not source of truth.

## Documentation-only references (informational, not runtime)
- 100+ files under `docs/`, `archive/`, top-level `*.md`/`*.json` reports — they cite `database/*.sql` in narrative text. Safe to leave during Phase C; consider rewriting in Phase F.

## Conclusion
`database/` has **15 hard runtime-or-operator references** in production code. Phase C of the master plan **must not** archive `database/` wholesale until each of those 15 references is either:
1. removed (the table now ships via `supabase/migrations/`), OR
2. redirected to a new canonical migration name, OR
3. preserved as a stable archive path with a CI-enforced freeze on its contents.
