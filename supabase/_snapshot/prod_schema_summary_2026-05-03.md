# Prod Schema Snapshot — 2026-05-03

> Read-only snapshot. No `pg_dump` was executed (Supabase CLI not invoked in this audit). Captured via MCP queries against `information_schema`, `pg_class`, `pg_policies`, `pg_extension`.

## Counts
- `public` tables/views: **332**
- Tables with `rowsecurity = true`: **300**
- Tables with `rowsecurity = false`: **22** (see RLS gap list below)
- Tables with `rowsecurity = true` but **0 policies**: **22** (RLS-enabled-but-empty — anon/authenticated effectively blocked, service-role still passes)
- Applied migrations (`schema_migrations`): **32**
- Repo migration files (`supabase/migrations/*.sql`): **170**

## Extensions installed
| Extension | Version |
|---|---|
| pg_cron | 1.6.4 |
| pg_net | 0.19.5 |
| pg_stat_statements | 1.11 |
| pgcrypto | 1.3 |
| plpgsql | 1.0 |
| supabase_vault | 0.3.1 |
| uuid-ossp | 1.1 |
| vector | 0.8.0 |

`pg_cron`, `pg_net`, `vector`, `supabase_vault` are required for clean local replay (Phase E).

## RLS Gap List — RLS DISABLED (22 tables)
```
active_lead_automation_settings
active_lead_memory
active_lead_runs
active_leads
canonical_backlink_signals
company_llm_configs
company_setup_progress
creator_execution_audit_logs
creator_execution_dead_letter_queue
creator_execution_metrics
creator_execution_summaries
creator_template_registry
decision_priority_queue
earn_credit_actions
external_api_assignments
external_api_connections
external_api_usage_logs
feedback_submissions
market_pulse_automation_settings
market_pulse_findings
market_pulse_memory
market_pulse_runs
post_analytics_polls
referrals
report_automation_configs
report_automation_events
whatsapp_broadcast_recipients
whatsapp_broadcasts
whatsapp_conversations
whatsapp_media_cache
whatsapp_messages
whatsapp_templates
```

## RLS Gap List — RLS enabled, 0 POLICIES (22 tables — service-role-only)
```
analytics_integrations
analytics_properties
analytics_provider_config
analytics_tokens
api_idempotency_keys
company_blog_comments
company_blog_relationships
company_blog_series
company_blog_series_posts
contacts
credit_admin_grants
email_jobs
engagement_platform_preferences
intelligence_actions
lead_signals
super_admin_audit_logs
```

(Several rows above are noted as `policy_count=0` with RLS on — anon/authenticated cannot read them at all; only service-role bypass works. Confirm whether that is intended for each.)

## Note
Full `pg_dump` should be produced by an operator with the Supabase CLI before any modification phase begins. This file is the structural inventory only.
