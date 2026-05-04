# RLS Full Audit — 2026-05-04 (Phase D, Step 1)

Source: `pg_class` + `pg_policies` for `schema = 'public'`, `relkind = 'r'` (excludes views/materialized views).

## Counts

| Bucket | Count |
|---|---|
| Total `public.*` tables | **313** |
| RLS ON | 279 |
| RLS OFF | **34** |
| RLS ON, ≥1 policy | 263 |
| RLS ON, **0 policies** (effective lockout for non-service-role) | **16** |
| RLS ON, ≥1 service_role policy | 263 |
| Tables needing action (Step 4 migrations) | **50** |

## Bucket A — RLS OFF (34 tables, CRITICAL)

These tables currently allow anon/authenticated reads via the Supabase anon key without any policy enforcement. Multi-tenant data leakage is possible if any of them is reachable from an anon-key client.

```
active_lead_automation_settings    active_lead_memory                 active_lead_runs
active_leads                       canonical_backlink_signals         company_llm_configs
company_setup_progress             creator_execution_audit_logs       creator_execution_dead_letter_queue
creator_execution_metrics          creator_execution_summaries        creator_template_registry
decision_priority_queue            earn_credit_actions                external_api_assignments
external_api_connections           external_api_usage_logs            feedback_submissions
llm_models                         llm_providers                      market_pulse_automation_settings
market_pulse_findings              market_pulse_memory                market_pulse_runs
post_analytics_polls               referrals                          report_automation_configs
report_automation_events           whatsapp_broadcast_recipients      whatsapp_broadcasts
whatsapp_conversations             whatsapp_media_cache               whatsapp_messages
whatsapp_templates
```

## Bucket B — RLS ON, 0 POLICIES (16 tables, HIGH)

RLS is enabled but no policies exist. Effective behavior:
- `service_role` → BYPASSES RLS, full access
- `anon`, `authenticated` → BLOCKED (every query returns 0 rows or fails)

This is "secure by default" but masks the true intent. UI surfaces talking to these tables via anon/auth key get silent empty results.

```
analytics_integrations          analytics_properties              analytics_provider_config
analytics_tokens                api_idempotency_keys              company_blog_comments
company_blog_relationships      company_blog_series               company_blog_series_posts
contacts                        credit_admin_grants               email_jobs
engagement_platform_preferences intelligence_actions              lead_signals
super_admin_audit_logs
```

## Bucket C — RLS ON, ≥1 POLICY (263 tables, OK baseline)

Most use the convention `CREATE POLICY "service_role_all" ON … FOR ALL USING (auth.role() = 'service_role')` — service-role-only access. Distribution by policy count:

| Policy count | Tables |
|---|---|
| 4 | 13 (canonical_*, action_registry, campaigns, decision_*, data_source_status, user_preferences) |
| 3 | 2 (extension_commands, reports) |
| 2 | 8 (access_requests, company_blog_read_sessions, extension_events, extension_sessions, feature_completion, free_credit_profiles, notifications, user_override) |
| 1 | 240 (everything else — predominantly the `service_role_all` baseline) |

These do **not** require Phase D action — they are at minimum-viable baseline. Per-table audit of policy correctness (e.g., are the 4-policy tables overly permissive?) is a separate hardening pass.

## Role coverage analysis (Bucket C only)

- Tables with explicit `service_role` policies: 263 / 263 (matches the dominant baseline)
- Tables with explicit `authenticated` policies: 26 (those tables expose authenticated reads)
- Tables with explicit `anon` policies: ~5 (e.g., `public_blogs`, `public_email_providers`, `disposable_domains`, `blocked_domains` — public-read tables)
- Tables with `public` (PUBLIC pseudo-role) policies: ~10

Net: existing prod RLS is dominated by service-role-only access. Only a small set exposes anon/authenticated reads. This audit is consistent with backend-driven access patterns (everything routes through Next.js API → service-role Supabase client).

## Method note

The earlier Phase A snapshot said 22 tables had RLS off; this audit (run 2026-05-04) reports 34. The delta is explained by:
- Phase A relied on a now-stale RLS query truncated at 22.
- This audit pulled all 313 tables. The delta of 12 includes new tables created after Phase A (e.g., the Phase B/C/B0 reconstructions).
- Net direction is unchanged: RLS coverage is still incomplete.
