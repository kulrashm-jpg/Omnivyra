# Idempotency Violations — Phase B1 (2026-05-04)

Per user instruction: identify, do not fix.

## Active canonical set: 33 files (baseline + 32)

| File | Status | Notes |
|---|---|---|
| 00000000000000_baseline_schema.sql | ✅ GUARDED | All `CREATE TABLE IF NOT EXISTS` + DO blocks for constraints + `CREATE INDEX IF NOT EXISTS` |
| 20260321_credit_ledger_hardening.sql | ✅ GUARDED | Rewritten in B1 step 1 with DO blocks |
| 20260322_wallet_reservation.sql | ✅ GUARDED | Rewritten in B1 step 1 |
| 20260323_remove_balance_credits.sql | ✅ GUARDED | `DROP FUNCTION IF EXISTS`, `CREATE OR REPLACE`, `DROP COLUMN IF EXISTS` |
| 20260411105217_fix_user_preferences_fk_to_public_users.sql | ❌ NOT GUARDED | `DROP CONSTRAINT user_preferences_user_id_fkey` (no IF EXISTS); `ADD CONSTRAINT` (no guard) |
| 20260420180351_rename_twitter_platform_to_x.sql | ✅ GUARDED | UPDATE WHERE platform='twitter' is naturally idempotent |
| 20260421043806_consolidate_meta_oauth_under_facebook.sql | ✅ GUARDED | DELETE is idempotent |
| 20260421212530_email_jobs_idempotency_columns.sql | ✅ GUARDED | All `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS` |
| 20260421213951_lockdown_idempotency_remainder.sql | ✅ GUARDED | DO block for constraint, IF NOT EXISTS throughout, `CREATE OR REPLACE FUNCTION` |
| 20260421221750_free_credits_admin.sql | ✅ GUARDED | `CREATE TABLE IF NOT EXISTS`, DO block for policy, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE VIEW`/`FUNCTION` |
| 20260421221758_lockdown_idempotency_manual_credit_grants.sql | ✅ GUARDED | All IF NOT EXISTS |
| 20260422054439_backfill_credit_log_tables_and_expiry_fn.sql | ✅ GUARDED | `CREATE TABLE IF NOT EXISTS`, DO blocks, `CREATE OR REPLACE` |
| 20260422072917_action_pricing_config_source_type_and_seed.sql | ✅ GUARDED | DO block for constraint, `ON CONFLICT DO NOTHING`, `ADD COLUMN IF NOT EXISTS` |
| 20260422073413_credit_confirm_partial_and_underfunded_flag.sql | ✅ GUARDED | `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION` |
| 20260422074957_content_generation_action_pricing.sql | ✅ GUARDED | `ON CONFLICT DO NOTHING` |
| 20260422075406_usage_events_input_output_cost_split.sql | ✅ GUARDED | `ADD COLUMN IF NOT EXISTS` |
| 20260422101355_llm_model_pricing_context_limits.sql | ✅ GUARDED | `ADD COLUMN IF NOT EXISTS` + UPDATE seeds (no-ops on second run) |
| 20260422192026_auth_user_has_password_fn.sql | ✅ GUARDED | `CREATE OR REPLACE FUNCTION` |
| 20260422192904_signup_referrals.sql | ✅ GUARDED | `CREATE TABLE IF NOT EXISTS`, DO block for policy, `DROP CONSTRAINT IF EXISTS` |
| 20260425110018_community_ai_actions_executor_columns.sql | ✅ GUARDED | All IF NOT EXISTS |
| 20260425140421_phase7_rpa_operations.sql | ✅ GUARDED | All IF NOT EXISTS, DO blocks for policies |
| 20260427000806_email_jobs_job_type_add_inbound_signup_notice.sql | ✅ GUARDED | `DROP CONSTRAINT IF EXISTS` |
| 20260427155620_community_ai_actions_allow_dm_action_type.sql | ✅ GUARDED | `DROP CONSTRAINT IF EXISTS` |
| 20260428152012_add_industry_to_users.sql | ✅ GUARDED | `ADD COLUMN IF NOT EXISTS` |
| 20260501094752_company_domains_final_domain_unique_and_not_null.sql | ❌ NOT GUARDED | `ADD CONSTRAINT unique_final_domain UNIQUE (final_domain)` — no DO-block guard. `ALTER COLUMN … SET NOT NULL` is idempotent |
| 20260501100836_company_domains_drop_legacy_domain_and_add_check.sql | ❌ NOT GUARDED | `DROP COLUMN domain CASCADE` — no IF EXISTS. `ADD CONSTRAINT final_domain_not_empty` — no DO-block guard |
| 20260501101239_company_domains_verification_proof_columns.sql | ✅ GUARDED | `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` |
| 20260501102230_company_domains_verification_method_dns_http.sql | ✅ GUARDED | `DROP CONSTRAINT IF EXISTS` |
| 20260501110320_domain_events_table.sql | ✅ GUARDED | `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` |
| 20260501113406_domain_reminders_table.sql | ✅ GUARDED | Same pattern |
| 20260501115028_domain_reminders_pg_cron_schedule.sql | ✅ GUARDED | `CREATE EXTENSION IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, unschedule-then-schedule pattern |
| 20260503043104_creator_execution_engine.sql | ✅ GUARDED | `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS` |
| 20260503043152_creator_execution_reliability.sql | ✅ GUARDED | `ADD COLUMN IF NOT EXISTS`, DO blocks for constraints, `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION` |

## Tally
- **Guarded:** 30/33 (91%)
- **NOT guarded:** 3/33 (9%)

## The 3 NOT GUARDED files

### 1. `20260411105217_fix_user_preferences_fk_to_public_users.sql`
Statement that fails on second apply:
```sql
ALTER TABLE public.user_preferences
  DROP CONSTRAINT user_preferences_user_id_fkey,
  ADD CONSTRAINT user_preferences_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
```
**Failure on replay:** if FK already dropped → second apply throws `constraint "user_preferences_user_id_fkey" of relation "user_preferences" does not exist`.

### 2. `20260501094752_company_domains_final_domain_unique_and_not_null.sql`
Statement that fails on second apply:
```sql
ALTER TABLE company_domains
  ADD CONSTRAINT unique_final_domain UNIQUE (final_domain);
```
**Failure on replay:** `relation "unique_final_domain" already exists` on second apply.

### 3. `20260501100836_company_domains_drop_legacy_domain_and_add_check.sql`
Statements that fail on second apply:
```sql
ALTER TABLE company_domains DROP COLUMN domain CASCADE;
ALTER TABLE company_domains ADD CONSTRAINT final_domain_not_empty CHECK (final_domain <> '');
```
**Failure on replay:** `column "domain" of relation "company_domains" does not exist` on second apply, then `constraint "final_domain_not_empty" already exists`.

## Why not fixed in B1
User directive: "Do not modify yet" + B0-step C4 noted that adding guards changes file content/hash. Hash drift could collide with `supabase migration repair` later. Fix in dedicated follow-up after replay validation in Phase E.

## Recommended fix template (do NOT apply yet)
```sql
-- Pattern A: drop+add constraint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='<name>') THEN
    ALTER TABLE … DROP CONSTRAINT <name>;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='<new_name>') THEN
    ALTER TABLE … ADD CONSTRAINT <new_name> …;
  END IF;
END $$;

-- Pattern B: drop column
ALTER TABLE … DROP COLUMN IF EXISTS <col> CASCADE;
```
