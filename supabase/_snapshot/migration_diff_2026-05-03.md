# Migration Diff — Repo vs Applied (2026-05-03)

## Summary
| Bucket | Count |
|---|---|
| Files in `supabase/migrations/` | **170** |
| Versions in `schema_migrations` | **32** |
| Repo files NOT in `schema_migrations` | **167** |
| Applied versions with NO matching repo file | **29** |
| Filenames matching by `version_name` | **3** (`20260321_credit_ledger_hardening`, `20260322_wallet_reservation`, `20260323_remove_balance_credits`) |

## Why the gap?
Two distinct timestamp formats coexist:

- **Repo style** — `YYYYMMDD_<slug>.sql` (date-only, 8 digits)
- **Applied style** — `YYYYMMDDHHMMSS_<slug>` (date+time, 14 digits)

The 29 long-form applied versions were applied via the Supabase CLI (`supabase db push`) and their source SQL is **not present in the repo migrations folder**. They live only in Supabase's record. This means the repo is **not** the authoritative source for those 29 changes.

## Bucket A — Applied but missing from repo (29 files)
These represent schema changes that exist in prod but have **no checked-in SQL**. Source-of-truth is currently the Supabase project's internal storage.

```
20260411105217_fix_user_preferences_fk_to_public_users
20260420180351_rename_twitter_platform_to_x
20260421043806_consolidate_meta_oauth_under_facebook
20260421212530_email_jobs_idempotency_columns
20260421213951_lockdown_idempotency_remainder
20260421221750_free_credits_admin
20260421221758_lockdown_idempotency_manual_credit_grants
20260422054439_backfill_credit_log_tables_and_expiry_fn
20260422072917_action_pricing_config_source_type_and_seed
20260422073413_credit_confirm_partial_and_underfunded_flag
20260422074957_content_generation_action_pricing
20260422075406_usage_events_input_output_cost_split
20260422101355_llm_model_pricing_context_limits
20260422192026_auth_user_has_password_fn
20260422192904_signup_referrals
20260425110018_community_ai_actions_executor_columns
20260425140421_phase7_rpa_operations
20260427000806_email_jobs_job_type_add_inbound_signup_notice
20260427155620_community_ai_actions_allow_dm_action_type
20260428152012_add_industry_to_users
20260501094752_company_domains_final_domain_unique_and_not_null
20260501100836_company_domains_drop_legacy_domain_and_add_check
20260501101239_company_domains_verification_proof_columns
20260501102230_company_domains_verification_method_dns_http
20260501110320_domain_events_table
20260501113406_domain_reminders_table
20260501115028_domain_reminders_pg_cron_schedule
20260503043104_creator_execution_engine
20260503043152_creator_execution_reliability
```

Note: several have **slug collisions** with repo files (e.g., `phase7_rpa_operations`, `signup_referrals`, `domain_events_table`, `auth_user_has_password_fn`). The repo files are likely **shadow copies** that were never registered.

## Bucket B — Repo but not applied (167 files)
Splits as:
- **104 past-dated unapplied** (≤ 2026-05-03)
- **63 future-dated unapplied** (> 2026-05-03)

The entire range `20260504..20260630` (63 files) is future-dated and absent from `schema_migrations` — these are the audit's "future-dated migration" findings.

## Bucket C — Filename matches (3)
These 3 short-form versions appear identically in both lists:

| Version | Repo filename | Applied name |
|---|---|---|
| 20260321 | `20260321_credit_ledger_hardening.sql` | `credit_ledger_hardening` |
| 20260322 | `20260322_wallet_reservation.sql` | `wallet_reservation` |
| 20260323 | `20260323_remove_balance_credits.sql` | `remove_balance_credits` |

These are the only files where the repo can be confidently said to track the applied state.

## Duplicate-timestamp clusters in repo (need disambiguation in Phase B8)
Distinct date-prefix → file count:

```
20260320 → 9 files     20260321 → 4     20260322 → 12    20260323 → 10
20260325 → 5           20260327 → 2     20260329 → 6     20260330 → 6
20260331 → 4           20260402 → 2     20260406 → 2     20260420 → 2
20260421 → 5           20260422 → 8     20260428 → 2     20260429 → 2
20260430 → 4           20260506 → 2     20260508 → 3     20260509 → 3
20260515 → 2           20260612 → 2
```

Supabase CLI orders by filename; same-day files apply in lexicographic slug order. If two same-day files mutate the same object in conflicting orders, replay can break.
