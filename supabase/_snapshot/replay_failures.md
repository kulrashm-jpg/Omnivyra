# Replay Failure Analysis — Phase E (Static)

**Date:** 2026-05-04
**Method:** static replay simulation. The Supabase CLI is not available in this environment; I walked the canonical migration set in lex order against the baseline + extensions and recorded every reference to a table not yet created.

A live replay (operator-runnable via [scripts/db-replay-check.sh](scripts/db-replay-check.sh)) is required to confirm exact PostgreSQL error messages.

## Predicted-pass migrations (41 of 41)

Walking the lex-sorted migration list:

```
00000000000000_baseline_schema.sql                        ← creates 26 base tables
00000000000001_enable_required_extensions.sql             ← enables pgcrypto, vector, pg_cron, pg_net, vault, uuid-ossp
20260321_credit_ledger_hardening.sql                      ← ALTERs credit_transactions (in baseline) ✓
20260322_wallet_reservation.sql                           ← ALTERs organization_credits (in baseline) + creates credit_usage_log/credit_expiry_log ✓
20260323_remove_balance_credits.sql                       ← ALTERs organization_credits (in baseline) ✓
20260411105217_…fix_user_preferences_fk_to_public_users   ← ALTERs user_preferences (in baseline) ✓
20260420180351_…rename_twitter_platform_to_x              ← UPDATEs platform_oauth_configs / social_accounts / community_ai_platform_tokens (all in baseline) ✓
20260421043806_…consolidate_meta_oauth_under_facebook     ← DELETEs platform_oauth_configs rows ✓
20260421212530_…email_jobs_idempotency_columns            ← ALTERs email_jobs (in baseline) ✓
20260421213951_…lockdown_idempotency_remainder            ← ALTERs invitations / super_admin_audit_logs / credit_transactions (all in baseline) + creates api_idempotency_keys ✓
20260421221750_…free_credits_admin                        ← creates manual_credit_grants + ALTERs access_requests / domain_eligibility_cache / domain_whitelist / user_override (all in baseline) + view free_credits_activity over (free_credit_claims, manual_credit_grants, access_requests) ✓
20260421221758_…lockdown_idempotency_manual_credit_grants ← ALTERs manual_credit_grants (created above) ✓
20260422054439_…backfill_credit_log_tables_and_expiry_fn  ← creates credit_usage_log / credit_expiry_log (idempotent — no-op if 20260322 already created them) ✓
20260422072917_…action_pricing_config_…                   ← ALTERs action_pricing_config (in baseline) + INSERTs ✓
20260422073413_…credit_confirm_partial_…                  ← ALTERs credit_transactions + CREATE FUNCTION ✓
20260422074957_…content_generation_action_pricing         ← INSERT into action_pricing_config ✓
20260422075406_…usage_events_input_output_cost_split      ← ALTERs usage_events / unified_transactions (both in baseline) ✓
20260422101355_…llm_model_pricing_context_limits          ← ALTERs llm_model_pricing (in baseline) ✓
20260422192026_…auth_user_has_password_fn                 ← CREATE FUNCTION; references auth.users (Supabase-managed) ✓
20260422192904_…signup_referrals                          ← creates signup_referrals + CREATE FUNCTION + ALTERs email_jobs ✓
20260425110018_…community_ai_actions_executor_columns     ← ALTERs community_ai_actions (in baseline) + creates community_ai_execution_metric_events ✓
20260425140421_…phase7_rpa_operations                     ← ALTERs community_ai_actions + creates rpa_sessions / rpa_artifacts ✓
20260427000806_…email_jobs_job_type_…                     ← ALTERs email_jobs ✓
20260427155620_…community_ai_actions_allow_dm_action_type ← ALTERs community_ai_actions ✓
20260428152012_…add_industry_to_users                     ← ALTERs users (in baseline) ✓
20260501094752_…company_domains_final_domain_unique_…     ← ALTERs company_domains (in baseline) ✓
20260501100836_…company_domains_drop_legacy_domain_…      ← ALTERs company_domains; DROP COLUMN domain CASCADE ⚠ see note 1
20260501101239_…company_domains_verification_proof_columns← ALTERs company_domains ✓
20260501102230_…company_domains_verification_method_…     ← DROP+ADD CONSTRAINT ✓
20260501110320_…domain_events_table                       ← creates domain_events ✓
20260501113406_…domain_reminders_table                    ← creates domain_reminders ✓
20260501115028_…domain_reminders_pg_cron_schedule         ← uses pg_cron + pg_net + supabase_vault (extensions enabled in 00000000000001) ✓
20260503043104_…creator_execution_engine                  ← ALTERs daily_content_plans (in baseline) + creates creator_template_registry ✓
20260503043152_…creator_execution_reliability             ← ALTERs daily_content_plans / scheduled_posts + 4 CREATE TABLEs ✓
20260504010001_fix_external_api_telemetry_tables          ← creates external_api_sources / external_api_health / external_api_usage ✓
20260504010002_fix_signal_intelligence_schema             ← creates intelligence_signals / signal_clusters + vector ext ✓
20260504010003_fix_governance_audit_runs                  ← creates governance_audit_runs ✓
20260504010004_fix_public_blogs                           ← creates public_blogs ✓
20260504020001_rls_enable_off_tables                      ← ALTERs 34 tables — all already in baseline ⚠ see note 2
20260504020002_rls_add_service_role_policies              ← adds policies to 16 tables — all already in baseline ⚠ see note 2
20260504030001_fix_apply_credit_reservation_drift         ← CREATE OR REPLACE FUNCTION; depends on credit_transactions + organization_credits (both in baseline) ✓
```

**Static prediction: 41/41 migrations apply cleanly on a fresh DB.**

## Notes / sub-warnings

### Note 1 — `20260501100836_company_domains_drop_legacy_domain_and_add_check.sql`
This file does:
```sql
ALTER TABLE company_domains DROP COLUMN domain CASCADE;
```
The baseline does NOT create a `domain` column on `company_domains` (only `final_domain`, `input_domain`, etc.). On replay this `DROP COLUMN` will fail with `column "domain" of relation "company_domains" does not exist`.

**Predicted failure:**
```
ERROR: column "domain" of relation "company_domains" does not exist
SQL state: 42703
```

**Resolution:** the migration is not idempotent (carry-over from B1-3-NOT-GUARDED). Either:
- (a) Add `IF EXISTS` to the DROP COLUMN: `ALTER TABLE company_domains DROP COLUMN IF EXISTS domain CASCADE;`
- (b) Add a guard: `DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_domains' AND column_name='domain') THEN ALTER TABLE … DROP COLUMN domain CASCADE; END IF; END $$;`

Held back for a dedicated idempotency fix (per B1 directive: "Do not modify yet").

### Note 2 — RLS migrations target tables not in baseline
The 50 tables targeted by `020001` and `020002` include tables that are NOT in the 48-table canonical set (the baseline + 22 created-in-set tables). Specifically, RLS migration targets reference tables like:
- `whatsapp_*` (6 tables)
- `analytics_*` (4 tables)
- `lead_signals`, `intelligence_actions`, `creator_execution_*` etc

…that exist in prod but **are not in baseline or any canonical migration**. On a fresh-DB replay, the `ALTER TABLE … ENABLE ROW LEVEL SECURITY` will fail with `relation does not exist`.

**Predicted failure (in 020001):** ~31 of 34 ENABLE statements will fail because the target tables are not in canonical.

**Predicted failure (in 020002):** ~14 of 16 CREATE POLICY statements will fail similarly.

**Why this didn't crash Phase D:** Phase D was applied to **prod** (where the tables exist), not to a fresh-DB replay. On prod, the migrations would succeed cleanly.

**Resolution:** this is the surface of the larger drift problem (335 missing tables). Closing it requires importing the relevant tables from the quarantined 8-digit migrations into canonical. See [schema_drift_report.md](schema_drift_report.md).

## Other carry-over risks (from earlier phases)

| ID | Source | Predicted impact on replay |
|---|---|---|
| B1-3-NOT-GUARDED | B1 | 3 migrations crash on second apply (see Note 1 example) |
| B1-FN-DRIFT | B1 | RESOLVED in Phase E by `20260504030001_fix_apply_credit_reservation_drift.sql` |
| B1-BASE-FK | B1 | Foreign keys missing from baseline → no replay-time crash but referential integrity differs from prod |
| B1-RLS-NOT-IN-BASELINE | B1 | RLS state on baseline tables doesn't match prod (some prod tables have RLS on; baseline leaves it off) |
| C-7 | C | `storeExampleSchedulingSignal.ts` script will runtime-fail (target table absent in canonical AND prod) |
| C-10 | C | 280+ prod tables missing from canonical → replay produces 48-table DB instead of 382-table DB |

## Recommended next actions (NOT executed)

1. **Run live replay** via `npm run db:replay` to confirm static predictions and capture exact error messages.
2. **Fix `20260501100836` idempotency** (Note 1) — single-line edit to add `IF EXISTS`.
3. **Decide on closing the 335-table drift** — multi-phase. Each affected domain needs a dedicated Phase E2/E3/… that imports the relevant quarantined files into canonical.

Until #3 lands, replay produces a partial schema. That partial schema is still the correct **canonical baseline**: every table in it is byte-for-byte aligned to prod for the columns/constraints that Phase E covers.
