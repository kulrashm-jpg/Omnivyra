# Missing Baseline Tables — Phase B1 (2026-05-04)

## Summary
- Tables referenced by the 32 canonical migrations: ~ 42 distinct
- Tables created BY the 32 canonical migrations: 16
- Tables referenced but never created → **26** (the baseline gap)

All 26 are present in current prod (verified via `information_schema.tables`).

## The 26 missing baseline tables (alphabetical)

| # | Table | Referenced by (first canonical migration) | Reference type |
|---|---|---|---|
| 1 | access_requests | 20260421221750_free_credits_admin | ALTER ADD COLUMN; SELECT in view |
| 2 | action_pricing_config | 20260422072917_action_pricing_config_source_type_and_seed | ALTER ADD COLUMN; INSERT seeds |
| 3 | community_ai_actions | 20260425110018_community_ai_actions_executor_columns | ALTER ADD COLUMN |
| 4 | community_ai_platform_tokens | 20260420180351_rename_twitter_platform_to_x | UPDATE |
| 5 | companies | 20260422192904_signup_referrals | FK target REFERENCES |
| 6 | company_domains | 20260501094752_company_domains_final_domain_unique_and_not_null | ALTER ADD CONSTRAINT |
| 7 | credit_transactions | 20260321_credit_ledger_hardening | ALTER ADD COLUMN |
| 8 | daily_content_plans | 20260503043104_creator_execution_engine | ALTER ADD COLUMN |
| 9 | domain_eligibility_cache | 20260421221750_free_credits_admin | ALTER ADD COLUMN |
| 10 | domain_whitelist | 20260421221750_free_credits_admin | ALTER ADD COLUMN |
| 11 | email_jobs | 20260421212530_email_jobs_idempotency_columns | ALTER ADD COLUMN; CHECK |
| 12 | free_credit_claims | 20260421221750_free_credits_admin | SELECT in view |
| 13 | free_credit_profiles | 20260421221750_free_credits_admin | SELECT in fn |
| 14 | invitations | 20260421213951_lockdown_idempotency_remainder | ALTER ADD COLUMN; FK |
| 15 | llm_model_pricing | 20260422101355_llm_model_pricing_context_limits | ALTER ADD COLUMN; UPDATE seeds |
| 16 | organization_credits | 20260322_wallet_reservation | ALTER ADD COLUMN |
| 17 | platform_oauth_configs | 20260420180351_rename_twitter_platform_to_x | UPDATE; DELETE |
| 18 | scheduled_posts | 20260503043152_creator_execution_reliability | ALTER ADD COLUMN |
| 19 | social_accounts | 20260420180351_rename_twitter_platform_to_x | UPDATE |
| 20 | super_admin_audit_logs | 20260421213951_lockdown_idempotency_remainder | ALTER ADD COLUMN |
| 21 | unified_transactions | 20260422075406_usage_events_input_output_cost_split | ALTER ADD COLUMN |
| 22 | usage_events | 20260422075406_usage_events_input_output_cost_split | ALTER ADD COLUMN |
| 23 | user_company_roles | 20260421221750_free_credits_admin | UPDATE role rename |
| 24 | user_override | 20260421221750_free_credits_admin | ALTER ADD COLUMN |
| 25 | user_preferences | 20260411105217_fix_user_preferences_fk_to_public_users | DROP+ADD CONSTRAINT |
| 26 | users | 20260428152012_add_industry_to_users | ALTER ADD COLUMN |

## Resolution
Generated [supabase/migrations/00000000000000_baseline_schema.sql](supabase/migrations/00000000000000_baseline_schema.sql) — runs first by lex order, creates all 26 tables idempotently, plus indexes/constraints sufficient for the canonical migration chain.

## Known omissions in baseline (deferred follow-ups)

These were intentionally excluded from the baseline file to keep B1 scoped:
1. **Foreign keys** — to public.* and auth.* tables. Adding them would chain a much larger set of tables into the baseline. Plan: add a separate `00000000000001_baseline_foreign_keys.sql` after Phase E replay verifies which ones are actually needed.
2. **Multi-line CHECK constraints on `scheduled_posts`** (`chk_content_type`, `chk_facebook_content`, `chk_hashtag_limits`, etc.) — present in prod but bulky; no canonical migration depends on them. Add in baseline FK pass.
3. **RLS policies** — owned by Phase D.
4. **Triggers, sequences, views** — none are referenced by the canonical migrations.

## Verification command (post-replay)
```sql
-- After replaying baseline + 32 canonical migrations on a fresh DB,
-- this should return zero rows (every prod table that the app touches exists locally):
SELECT tab FROM (VALUES ('access_requests'),('action_pricing_config'),
  ('community_ai_actions'),('community_ai_platform_tokens'),('companies'),
  ('company_domains'),('credit_transactions'),('daily_content_plans'),
  ('domain_eligibility_cache'),('domain_whitelist'),('email_jobs'),
  ('free_credit_claims'),('free_credit_profiles'),('invitations'),
  ('llm_model_pricing'),('organization_credits'),('platform_oauth_configs'),
  ('scheduled_posts'),('social_accounts'),('super_admin_audit_logs'),
  ('unified_transactions'),('usage_events'),('user_company_roles'),
  ('user_override'),('user_preferences'),('users'),
  ('api_idempotency_keys'),('manual_credit_grants'),('credit_usage_log'),
  ('credit_expiry_log'),('signup_referrals'),
  ('community_ai_execution_metric_events'),('rpa_sessions'),('rpa_artifacts'),
  ('domain_events'),('domain_reminders'),('creator_template_registry'),
  ('creator_execution_audit_logs'),('creator_execution_dead_letter_queue'),
  ('creator_execution_summaries'),('creator_execution_metrics')
) AS expected(tab)
WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
  WHERE table_schema='public' AND table_name=expected.tab);
```
