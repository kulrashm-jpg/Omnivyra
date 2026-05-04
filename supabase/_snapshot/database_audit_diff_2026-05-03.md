# database/ Folder Audit — 2026-05-03

## Inventory
- Total files in `database/`: **323**
  - `*.sql`: **314**
  - `*.ps1`: 4 (`cleanup-database.ps1`, `clear-campaign-data.ps1`, `setup-super-admin.ps1`, plus generated)
  - `*.sh`: 1 (`cleanup-database.sh`)
  - `*.md`: 2 (`README.md`, `SCHEMA_DOCUMENTATION.md`, `ui-structure-plan.md`)
- Total files in `supabase/migrations/`: 170 (`*.sql`)

## Naming convention divergence
- `database/*.sql` uses topic names (`blogs.sql`, `campaign-versions.sql`, `users.sql`).
- `supabase/migrations/*.sql` uses date-prefixed names (`20260322_blog_intelligence.sql`).
- **Zero filename overlap** — comparison must be by table/object names, not by filename.

## Risk items (move out of `database/` immediately, do not delete yet)

### `archive/dangerous/` candidates (destructive, runnable)
- `database/cleanup-database.ps1` — runs reset SQL
- `database/cleanup-database.sh` — runs reset SQL
- `database/clear-campaign-data.ps1` — wipes campaign tables
- `database/setup-super-admin.ps1` — privileged role insertion
- `database/cleanup-unnecessary-tables.sql` — drops tables
- `database/reset-and-apply-schema.sql` — full schema reset
- `database/campaign-management-clean-schema.sql` — referenced by README as the "clean install" script (drops + recreates)

### Verification scripts (reusable as test fixtures, not migrations)
- `database/verify-database.sql`
- `database/verify-database-state.sql`
- `database/verify_committed_plan.sql`
- `database/verify_daily_content_plans.sql`
- `database/campaign_delete_cascade_verify.sql`
- `database/campaign_plan_verify_links.sql`
- `database/validate-community-ai-platform-tokens.sql`
- `database/audit_daily_execution_tables.sql`
- `database/audit_daily_plan_duplication.sql`

### Probable duplicates of canonical migrations (need per-file check before move)
- `database/users.sql` — `users` table is canonical and managed by Supabase auth + multiple migrations
- `database/blogs.sql` — `blogs` table covered by `20260322_blog_intelligence.sql`, `20260322_blog_performance.sql`, etc.
- `database/campaign-versions.sql` — covered by `20260322_*` and `20260323_*`
- `database/usage_events.sql` / `usage_events_feature_area.sql` — covered by `20260422075406_usage_events_input_output_cost_split` (applied)
- `database/twelve_week_plan.sql` / `twelve_week_plan_status.sql`
- `database/whatsapp_system.sql` — tables exist in prod but **no RLS**; not represented in `supabase/migrations/`
- `database/worker_dead_letter_queue.sql`
- `database/audit-logs.sql`
- `database/api-integrations.sql`
- `database/business-intelligence-reports.sql`
- `database/buyer_intent_accounts.sql`
- `database/calendar_events_index.sql`
- `database/campaign-*.sql` (40+ files)
- `database/community_ai_*.sql` (multiple)
- `database/content_*.sql`
- `database/voice-notes-schema.sql`

### Files referenced by **runtime fallback messages** (HIGH RISK to move)
The following are printed in error/log messages telling operators to run them manually:
- `database/external_api_health.sql` — referenced 3× in `backend/services/externalApi*` and `backend/services/externalApiHealthService.ts`
- `database/external-api-usage.sql` — referenced 2× in `backend/services/externalApi/dbHelpers.ts` and `usageLogging.ts`
- `database/external_api_usage_signals_generated.sql` — referenced 3× in same files
- `database/governance_audit_runs.sql` — `backend/services/GovernanceAuditService.ts:94`
- `database/scheduling_intelligence_signals.sql` — `backend/scripts/storeExampleSchedulingSignal.ts:3`
- `database/platform_oauth_configs.sql` — `backend/scripts/seedPlatformOauthConfigsFromEnv.ts:4`
- `database/platform_registry.sql` — `backend/constants/platforms.ts:4` (comment reference)
- `database/signal_clusters_source_api_id.sql` — `backend/services/signalClusterEngine.ts:302`
- `database/add_signal_embeddings.sql` — same
- `database/public_blogs.sql` — `pages/admin/blog/index.tsx:143` (user-facing instruction)

**Implication:** `database/` cannot be archived wholesale. Each runtime-referenced file must first be (a) confirmed applied to prod, (b) folded into a fresh migration in `supabase/migrations/`, and (c) the runtime message updated or removed.

## Methodology used
- File listing: `ls database/` (323 entries).
- Cross-comparison with canonical migrations: filename heuristic only — semantic per-table comparison deferred to Phase B.
- Runtime-reference scan: `grep -rE "database[/\\\\][^\"'\\s]+\\.(sql|ps1|sh)"` across `backend/`, `pages/`, `components/`, `hooks/`, `scripts/`. Hit list saved to `database/_runtime_dependency_report.md`.
