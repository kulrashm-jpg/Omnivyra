# RLS Classification — 2026-05-04 (Phase D, Step 2)

| Bucket | Severity | Count | Action |
|---|---|---|---|
| **A. RLS OFF** | 🔴 CRITICAL | 34 | Migration `20260504020001` — enable RLS + add service_role_all in same statement (no lockout window) |
| **B. RLS ON, 0 POLICIES** | 🟡 HIGH | 16 | Migration `20260504020002` — add service_role_all policy |
| **C. RLS ON, 1 service_role policy** | 🟢 OK | 240 | None |
| **D. RLS ON, multi-policy** (anon/auth/admin etc.) | 🟢 OK | 23 | None (review out-of-scope) |
| **Total `public.*` tables** | | **313** | |

## Tenant column inventory for Buckets A + B (50 tables)

Used to inform whether a future hardening pass should layer user-scoped policies on top of the service_role_all baseline.

| Table | RLS OFF? | 0 policies? | has org | has company | has user | has tenant | Future policy hint |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| active_lead_automation_settings | ✓ |  |  | ✓ |  |  | company-scoped |
| active_lead_memory | ✓ |  |  | ✓ |  |  | company-scoped |
| active_lead_runs | ✓ |  |  | ✓ |  |  | company-scoped |
| active_leads | ✓ |  |  | ✓ |  |  | company-scoped |
| analytics_integrations |  | ✓ |  | ✓ |  |  | company-scoped |
| analytics_properties |  | ✓ |  |  |  |  | service-only |
| analytics_provider_config |  | ✓ |  |  |  |  | service-only |
| analytics_tokens |  | ✓ |  |  |  |  | service-only |
| api_idempotency_keys |  | ✓ |  |  |  |  | service-only (worker internal) |
| canonical_backlink_signals | ✓ |  |  | ✓ |  |  | company-scoped |
| company_blog_comments |  | ✓ |  | ✓ |  |  | public-read for published, write via service |
| company_blog_relationships |  | ✓ |  | ✓ |  |  | company-scoped |
| company_blog_series |  | ✓ |  | ✓ |  |  | company-scoped |
| company_blog_series_posts |  | ✓ |  |  |  |  | service-only |
| company_llm_configs | ✓ |  |  | ✓ |  |  | company-scoped |
| company_setup_progress | ✓ |  |  | ✓ |  |  | company-scoped |
| contacts |  | ✓ | ✓ |  |  |  | org-scoped |
| creator_execution_audit_logs | ✓ |  |  | ✓ | ✓ |  | company- or service-only |
| creator_execution_dead_letter_queue | ✓ |  |  |  |  |  | service-only |
| creator_execution_metrics | ✓ |  |  |  |  |  | service-only |
| creator_execution_summaries | ✓ |  |  |  |  |  | service-only |
| creator_template_registry | ✓ |  |  | ✓ |  |  | company-scoped + system-default |
| credit_admin_grants |  | ✓ | ✓ |  |  |  | admin-only (super_admin checked at API) |
| decision_priority_queue | ✓ |  |  | ✓ |  |  | service-only (worker internal) |
| earn_credit_actions | ✓ |  | ✓ |  | ✓ |  | user-scoped |
| email_jobs |  | ✓ |  |  |  |  | service-only (worker internal) |
| engagement_platform_preferences |  | ✓ |  | ✓ | ✓ |  | user+company-scoped |
| external_api_assignments | ✓ |  |  | ✓ |  |  | company-scoped |
| external_api_connections | ✓ |  |  | ✓ |  |  | company-scoped |
| external_api_usage_logs | ✓ |  |  | ✓ |  |  | company-scoped |
| feedback_submissions | ✓ |  | ✓ |  | ✓ |  | user+org-scoped |
| intelligence_actions |  | ✓ |  | ✓ |  |  | company-scoped |
| lead_signals |  | ✓ | ✓ |  |  |  | org-scoped |
| llm_models | ✓ |  |  |  |  |  | service-only / public-read |
| llm_providers | ✓ |  |  |  |  |  | service-only / public-read |
| market_pulse_automation_settings | ✓ |  |  | ✓ |  |  | company-scoped |
| market_pulse_findings | ✓ |  |  | ✓ |  |  | company-scoped |
| market_pulse_memory | ✓ |  |  | ✓ |  |  | company-scoped |
| market_pulse_runs | ✓ |  |  | ✓ |  |  | company-scoped |
| post_analytics_polls | ✓ |  |  | ✓ | ✓ |  | user+company-scoped |
| referrals | ✓ |  |  |  |  |  | service-only |
| report_automation_configs | ✓ |  |  | ✓ | ✓ |  | user+company-scoped |
| report_automation_events | ✓ |  |  | ✓ | ✓ |  | service-only |
| super_admin_audit_logs |  | ✓ |  |  |  |  | admin-only |
| whatsapp_broadcast_recipients | ✓ |  |  |  |  |  | service-only |
| whatsapp_broadcasts | ✓ |  |  | ✓ |  |  | company-scoped |
| whatsapp_conversations | ✓ |  |  | ✓ |  |  | company-scoped |
| whatsapp_media_cache | ✓ |  |  | ✓ |  |  | service-only / company-scoped |
| whatsapp_messages | ✓ |  |  |  |  |  | service-only |
| whatsapp_templates | ✓ |  |  | ✓ |  |  | company-scoped |

## Why service-role-only baseline (not company-scoped) for Phase D

1. **Matches existing prod convention.** 240 of 263 already-secured tables use exactly `service_role_all`. Following the established pattern reduces the chance of unexpected behavior.
2. **All backend access uses `SUPABASE_SERVICE_ROLE_KEY`.** The Next.js API routes and worker processes route through it. Service-role baseline does not break any existing code path.
3. **Minimum viable lockdown.** Closes the leakage risk on RLS-off tables in one step. Can be made stricter later without rollback risk.
4. **Avoids policy-correctness pitfalls.** A wrong company-scoped policy (e.g., wrong column name, wrong JWT claim) silently breaks features. Service-role-only has no such failure mode.

The "Future policy hint" column above is the input to a follow-up Phase D2 hardening pass that layers proper anon/authenticated policies for the user-facing tables.
