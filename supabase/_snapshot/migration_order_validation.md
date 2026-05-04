# Migration Order Validation — Phase B1 (2026-05-04)

## Active canonical migration set (33 files including baseline)

Lex order = execution order. Verified no duplicate timestamps, no gaps that break ordering.

```
00000000000000_baseline_schema.sql                                    ← NEW (baseline)
20260321_credit_ledger_hardening.sql                                  ← rewritten in B1 step 1
20260322_wallet_reservation.sql                                       ← rewritten in B1 step 1
20260323_remove_balance_credits.sql                                   ← rewritten in B1 step 1
20260411105217_fix_user_preferences_fk_to_public_users.sql            ← reconstructed in B0
20260420180351_rename_twitter_platform_to_x.sql                       ← reconstructed in B0
20260421043806_consolidate_meta_oauth_under_facebook.sql              ← B0
20260421212530_email_jobs_idempotency_columns.sql                     ← B0
20260421213951_lockdown_idempotency_remainder.sql                     ← B0
20260421221750_free_credits_admin.sql                                 ← B0
20260421221758_lockdown_idempotency_manual_credit_grants.sql          ← B0
20260422054439_backfill_credit_log_tables_and_expiry_fn.sql           ← B0
20260422072917_action_pricing_config_source_type_and_seed.sql         ← B0
20260422073413_credit_confirm_partial_and_underfunded_flag.sql        ← B0
20260422074957_content_generation_action_pricing.sql                  ← B0
20260422075406_usage_events_input_output_cost_split.sql               ← B0
20260422101355_llm_model_pricing_context_limits.sql                   ← B0
20260422192026_auth_user_has_password_fn.sql                          ← B0
20260422192904_signup_referrals.sql                                   ← B0
20260425110018_community_ai_actions_executor_columns.sql              ← B0
20260425140421_phase7_rpa_operations.sql                              ← B0
20260427000806_email_jobs_job_type_add_inbound_signup_notice.sql      ← B0
20260427155620_community_ai_actions_allow_dm_action_type.sql          ← B0
20260428152012_add_industry_to_users.sql                              ← B0
20260501094752_company_domains_final_domain_unique_and_not_null.sql   ← B0
20260501100836_company_domains_drop_legacy_domain_and_add_check.sql   ← B0
20260501101239_company_domains_verification_proof_columns.sql         ← B0
20260501102230_company_domains_verification_method_dns_http.sql       ← B0
20260501110320_domain_events_table.sql                                ← B0
20260501113406_domain_reminders_table.sql                             ← B0
20260501115028_domain_reminders_pg_cron_schedule.sql                  ← B0
20260503043104_creator_execution_engine.sql                           ← B0
20260503043152_creator_execution_reliability.sql                      ← B0
```

Total: **33 files** = 1 baseline + 32 schema_migrations entries.

## Dependency check — first ALTER on each table appears AFTER baseline CREATE

| First ALTER target | First migration that touches it | Required to exist before that point | Source of CREATE |
|---|---|---|---|
| user_preferences | 20260411105217 | ✓ | baseline |
| platform_oauth_configs | 20260420180351 | ✓ | baseline |
| social_accounts | 20260420180351 | ✓ | baseline |
| community_ai_platform_tokens | 20260420180351 | ✓ | baseline |
| email_jobs | 20260421212530 | ✓ | baseline |
| invitations | 20260421213951 | ✓ | baseline |
| super_admin_audit_logs | 20260421213951 | ✓ | baseline |
| credit_transactions | 20260321 (after baseline) | ✓ | baseline |
| organization_credits | 20260322 (after baseline) | ✓ | baseline |
| access_requests | 20260421221750 | ✓ | baseline |
| domain_eligibility_cache | 20260421221750 | ✓ | baseline |
| domain_whitelist | 20260421221750 | ✓ | baseline |
| user_override | 20260421221750 | ✓ | baseline |
| action_pricing_config | 20260422072917 | ✓ | baseline |
| usage_events | 20260422075406 | ✓ | baseline |
| unified_transactions | 20260422075406 | ✓ | baseline |
| llm_model_pricing | 20260422101355 | ✓ | baseline |
| community_ai_actions | 20260425110018 | ✓ | baseline |
| users | 20260428152012 | ✓ | baseline |
| companies | (FK from signup_referrals 20260422192904) | ✓ | baseline |
| company_domains | 20260501094752 | ✓ | baseline |
| daily_content_plans | 20260503043104 | ✓ | baseline |
| scheduled_posts | 20260503043152 | ✓ | baseline |
| user_company_roles | 20260421221750 (UPDATE role rename) | ✓ | baseline |
| free_credit_claims | 20260421221750 (referenced in free_credits_activity view) | ✓ | baseline |
| free_credit_profiles | 20260421221750 (referenced in free_credits_summary fn) | ✓ | baseline |

**Result:** all 26 base-table dependencies are satisfied by `00000000000000_baseline_schema.sql` running first.

## Tables created INSIDE the canonical set (verified no overlap with baseline)

Created by canonical migrations (must NOT also be in baseline):
- api_idempotency_keys (20260421213951)
- manual_credit_grants (20260421221750)
- credit_usage_log, credit_expiry_log (20260322 + idempotent re-create in 20260422054439)
- signup_referrals (20260422192904)
- community_ai_execution_metric_events (20260425110018)
- rpa_sessions, rpa_artifacts (20260425140421)
- domain_events (20260501110320)
- domain_reminders (20260501113406)
- creator_template_registry (20260503043104)
- creator_execution_audit_logs, creator_execution_dead_letter_queue, creator_execution_summaries, creator_execution_metrics (20260503043152)

Verified: none of these appear in baseline → no double-create on replay.

## Same-day timestamp clusters (lex order tiebreaker)

| Date | Files | Same-object overlap risk |
|---|---|---|
| 20260421 | 4 files | Low — distinct slugs touch different tables (idempotency_remainder, free_credits_admin, manual_credit_grants_idempotency) |
| 20260422 | 8 files | Low — distinct slugs |
| 20260425 | 2 files | Low |
| 20260427 | 2 files | Low |
| 20260501 | 7 files | Medium — three sequential `company_domains_*` rows; ordered correctly (final/drop_legacy → verification_proof → verification_method) |
| 20260503 | 2 files | Low |

No same-second collisions (Supabase records to second precision).

## Conclusion

Order is valid. Replay sequence: baseline → 32 canonical migrations applies cleanly under the assumptions documented in [missing_baseline_tables.md](missing_baseline_tables.md).
