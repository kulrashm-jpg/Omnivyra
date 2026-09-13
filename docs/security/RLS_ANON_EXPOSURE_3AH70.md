# Production anonymous / public-key exposure — inventory and remediation (STEP 3AH-70)

Measured read-only against production (`klkiseupptzbecbxwrky`) on 2026-09-14, main `9d706239`.
Remediation: `supabase/migrations/20261026000000_close_anon_rls_exposure.sql` — **prepared and validated, NOT applied to production.**

## 1. What was exposed

Supabase's default privileges (`pg_default_acl` for `postgres` in `public`) grant **ALL** on every new table and
**EXECUTE** on every new function to `anon` and `authenticated`. PostgREST serves the `public` schema to anyone holding
the publishable key, which ships in the browser bundle. RLS is therefore the only control, and:

| Class of object | Count | Exposure |
|---|---|---|
| Tables with RLS **disabled** | **177** | anon + authenticated: SELECT, INSERT, UPDATE, DELETE, TRUNCATE (651,866 rows; 40 non-empty) |
| SECURITY DEFINER functions executable by anon/authenticated/PUBLIC | **29** | run as owner → bypass RLS; 28 have **no caller check** |
| Owner-rights (non-`security_invoker`) views readable by anon/authenticated | **29** of 37 | owner rights bypass RLS on every table they read |
| Policies granting role `{public}` unconditional access on RLS tables | **11** (of 15 unconditional) | effectively RLS-off for those tables |
| TRUNCATE held by anon/authenticated | **835** public tables | TRUNCATE is **not governed by RLS** (unreachable today: PostgREST cannot issue it and no function runs caller SQL) |

Proven with the publishable key (count-only, no row content read): `feature_flags` (2 rows), `analytics_serp_results`
(9 rows); 213 of 214 tables/views answered an anonymous REST read. Writes were never attempted against production.

## 2. Application access audit (Track B)

* **Browser:** the only browser Supabase client is `lib/supabaseBrowser.ts` (publishable key). Across all 27 files that use
  it there is **no** `.from()`, view read or `.rpc()` — the browser performs no direct table access. The single browser
  database path is the realtime subscription on `credit_transactions` (`lib/swr/creditsRealtime.ts`), which already has
  RLS and a policy and is **not** touched. Client-file hits for four table names are UI strings/comments, not queries.
* **Server:** every server path — API routes (46 tables), cron (3), Railway worker (3), backend services (150), operator
  scripts (10) — uses the secret/service-role key (`backend/db/supabaseClient.ts`, `requireSupabaseSecretKey()`,
  `SUPABASE_SERVICE_ROLE_KEY`). `service_role` has **BYPASSRLS** and keeps its explicit grants.
* **Edge Functions:** none touch the affected tables. **pg_cron:** 2 jobs, run as the owner, none touch them.
* **RPC callers:** all 29 functions are called only server-side through the service-role client (or not at all).
* **Other paths checked:** 0 dormant policies on the 177 tables (enabling RLS activates nothing unexpected); no policy or
  view references the 29 functions; triggers on these tables are same-table immutability guards; none are in the realtime
  publication; no JWT-forwarding server client.

**Conclusion:** no legitimate anonymous or authenticated consumer depends on any of the exposed objects. Nothing needs a
new policy; nothing needs to move behind an API.

## 3. Classification

| Class | Meaning | Count |
|---|---|---|
| A | must never be public (credentials, tenant/person data, billing/credit controls, auth/audit, internal config) | 151 |
| B | legitimate browser access, needs an RLS policy | 0 |
| C | server-only, non-sensitive operational data | 26 |
| D | intentionally public, read-only | 0 of the 177 · 4 RLS-enabled tables (§5) |

Critical (credential / PII columns): `company_llm_configs`, `external_api_connections`, `whatsapp_broadcast_recipients`.
Billing, credit, auth, audit and configuration controls (34): `auth_audit_logs`, `billing_policy_config`, `company_llm_configs`, `consent_records`, `content_asset_platform_override`, `cost_budgets`, `cost_events`, `cost_reconciliation_adjustments`, `cost_reconciliation_runs`, `earn_credit_actions`, `external_api_assignments`, `external_api_connections`, `external_api_usage_logs`, `feature_flags`, `free_credit_grants`, `intelligence_company_overrides`, `intelligence_global_config`, `intelligence_governance_policies`, `intelligence_role_assignments`, `intelligence_roles`, `intelligence_throttle_config`, `ip_org_creations`, `monetization_beta_drills`, `monetization_beta_orgs`, `monetization_beta_support_actions`, `monetization_beta_support_cases`, `monetization_beta_users`, `operator_actions`, `pending_invite_unlocks`, `platform_cost_allocations`, `platform_cost_categories`, `provider_invoice_imports`, `referrals`, `token_refresh_locks`.
Non-empty tenant tables: `analytics_competitor_domains (9)`, `analytics_intelligence_snapshots (31)`, `analytics_serp_acquisition_runs (1)`, `analytics_serp_query_queue (1)`, `analytics_serp_results (9)`, `analytics_serp_snapshots (1)`, `block_templates (6)`, `company_setup_progress (5)`, `cost_events (109)`, `creator_audit_log (62)`, `creator_execution_audit_logs (318)`, `creator_operational_events (131)`, `creator_render_governance_state (1)`, `customer_population_classification (38)`, `engagement_identity_candidates (3)`, `feature_flags (2)`, `governance_audit_runs (296)`, `integration_activity_events (144)`, `intelligence_global_config (16)`, `intelligence_throttle_config (1)`, `market_pulse_findings (78)`, `market_pulse_memory (50)`, `market_pulse_runs (17)`, `post_analytics_polls (4)`, `report_automation_configs (5)`, `report_notification_events (4)`.

### 3.1 Per-table inventory (all 177)

Privileges: S=SELECT I=INSERT U=UPDATE D=DELETE T=TRUNCATE. Pre-fix, every row below is: RLS **off**; anon `SIUDT`;
authenticated `SIUDT`; service_role `SIUDT` + BYPASSRLS; browser/publishable-key usage **none**; required public access
**none**; required policy **none** (service_role bypasses RLS). Remediation for every row: **ENABLE RLS + REVOKE ALL FROM anon, authenticated**.

| table | class | rows | sensitive | code usage (path:files) |
|---|---|---|---|---|
| `active_lead_runs` | A | 0 | tenant:company_id | script:2 |
| `active_leads` | A | 0 | tenant:company_id | server:5 client:1 other:1 api:1 script:7 |
| `adapter_configs` | A | 0 | tenant:user_id | api:1 |
| `ai_message_drafts` | A | 0 | tenant:created_by | api:2 |
| `alert_rules` | A | 0 | tenant:organization_id+created_by | server:1 |
| `analyst_collection_items` | A | 0 | tenant:organization_id | server:1 |
| `analytics_competitor_domains` | A | 9 | tenant:company_id | server:2 |
| `analytics_intelligence_snapshots` | A | 31 | tenant:company_id | server:2 |
| `analytics_materializations` | A | 0 | tenant:organization_id | server:1 |
| `analytics_serp_acquisition_runs` | A | 1 | tenant:company_id | server:1 |
| `analytics_serp_provider_health` | C | 1 | — | server:1 |
| `analytics_serp_query_queue` | A | 1 | CRED:next_refresh_at; tenant:company_id | server:1 |
| `analytics_serp_results` | A | 9 | tenant:company_id | server:4 |
| `analytics_serp_snapshots` | A | 1 | tenant:company_id | server:1 |
| `analytics_warehouse_facts` | A | 0 | tenant:organization_id | server:2 |
| `angle_industry_matrix` | C | 27 | — | api:1 |
| `audit_export_jobs` | A | 0 | tenant:organization_id; control/audit/billing/config | server:1 |
| `auth_audit_logs` | A | 0 | tenant:user_id; control/audit/billing/config | server:4 api:1 |
| `author_identity_links` | A | 0 | tenant:organization_id | server:2 |
| `billing_policy_config` | A | 0 | tenant:organization_id; control/audit/billing/config | server:1 |
| `block_templates` | A | 6 | tenant:company_id+created_by; control/audit/billing/config | server:1 |
| `campaign_autonomous_learnings` | A | 0 | tenant:company_id | server:4 |
| `canonical_backlink_signals` | A | 0 | tenant:company_id | server:4 |
| `community_recommendations` | A | 0 | tenant:organization_id | server:2 |
| `company_execution_config` | A | 0 | tenant:company_id | server:1 api:1 |
| `company_llm_configs` | A | 0 | CRED:api_key_encrypted; tenant:company_id; control/audit/billing/config | server:1 |
| `company_scheduler_prefs` | A | 0 | tenant:company_id | cron:1 api:2 |
| `company_settings` | A | 0 | tenant:company_id | server:3 api:1 |
| `company_setup_progress` | A | 5 | tenant:company_id | server:3 api:3 |
| `consent_records` | A | 0 | tenant:organization_id; control/audit/billing/config | server:6 script:1 |
| `content_asset_attachment` | A | 0 | tenant:created_by | server:3 api:1 |
| `content_asset_platform_override` | A | 0 | tenant:created_by; control/audit/billing/config | server:1 api:1 |
| `content_core_asset` | A | 0 | tenant:organization_id+created_by | server:3 api:1 |
| `content_external_video_asset` | A | 0 | tenant:organization_id | api:1 |
| `copilot_responses` | A | 0 | tenant:organization_id | server:1 |
| `cost_budgets` | A | 0 | tenant:organization_id+created_by; control/audit/billing/config | server:1 |
| `cost_events` | A | 109 | tenant:organization_id; control/audit/billing/config | server:1 |
| `cost_reconciliation_adjustments` | A | 0 | tenant:organization_id; control/audit/billing/config | server:9 |
| `cost_reconciliation_runs` | A | 0 | control/audit/billing/config | server:6 |
| `creator_alert_state` | C | 0 | — | server:1 api:1 |
| `creator_audit_log` | A | 62 | tenant:actor_user_id+company_id; control/audit/billing/config | server:1 |
| `creator_cron_lease` | C | 0 | — | server:2 |
| `creator_dead_letter_jobs` | C | 0 | — | server:1 |
| `creator_execution_audit_logs` | A | 318 | tenant:company_id+user_id; control/audit/billing/config | server:2 |
| `creator_execution_dead_letter_queue` | C | 28 | — | server:1 |
| `creator_execution_metrics` | C | 670 | — | server:1 |
| `creator_execution_summaries` | C | 189 | — | server:1 |
| `creator_operational_events` | A | 131 | tenant:company_id+actor_user_id | server:3 |
| `creator_render_attempt` | C | 0 | — | server:2 api:2 |
| `creator_render_governance_state` | A | 1 | tenant:organization_id | api:4 |
| `creator_render_job` | A | 0 | tenant:organization_id+created_by | server:2 api:2 |
| `creator_render_job_events` | C | 24 | — | server:1 |
| `creator_render_job_state` | C | 0 | — | server:2 api:4 |
| `creator_render_jobs` | C | 6 | — | server:1 |
| `creator_render_metrics` | C | 1318 | — | server:1 |
| `creator_render_moderation_event` | C | 0 | — | api:1 |
| `creator_render_ops_audit` | A | 0 | control/audit/billing/config | api:1 |
| `creator_render_output` | C | 0 | — | server:2 |
| `creator_render_provider` | C | 4 | — | api:1 |
| `creator_render_queue_job` | C | 0 | — | server:1 api:4 |
| `creator_render_validation_manifests` | C | 555 | — | server:1 |
| `creator_render_variant` | C | 0 | — | server:2 |
| `creator_template_registry` | A | 0 | tenant:company_id | server:1 |
| `creator_upload_rate_state` | C | 0 | — | server:1 |
| `customer_operations_scores` | A | 0 | tenant:organization_id | server:1 |
| `customer_population_classification` | A | 38 | tenant:company_id | server:3 script:1 |
| `decision_priority_queue` | A | 0 | tenant:company_id | server:1 |
| `deployment_telemetry_snapshots` | A | 0 | tenant:organization_id | server:2 |
| `earn_credit_actions` | A | 0 | tenant:organization_id+user_id; control/audit/billing/config | server:1 |
| `engagement_identity_candidates` | A | 3 | tenant:unified_person_id | script:1 |
| `escalations` | A | 0 | tenant:organization_id | server:12 client:1 api:1 |
| `execution_observability_records` | A | 0 | tenant:organization_id | server:3 |
| `execution_partitions` | A | 0 | tenant:organization_id | server:4 |
| `external_api_assignments` | A | 0 | tenant:company_id; control/audit/billing/config | api:1 |
| `external_api_connections` | A | 0 | CRED:encrypted_credentials; tenant:company_id; control/audit/billing/config | api:2 |
| `external_api_usage_logs` | A | 0 | tenant:company_id; control/audit/billing/config | unreferenced |
| `feature_flags` | A | 2 | tenant:organization_id+created_by; control/audit/billing/config | server:4 script:1 |
| `feedback_submissions` | A | 0 | tenant:user_id+organization_id | api:3 |
| `free_credit_grants` | A | 0 | tenant:organization_id+user_id; control/audit/billing/config | api:1 |
| `governance_audit_runs` | A | 296 | tenant:company_id; control/audit/billing/config | server:2 client:1 api:1 script:1 |
| `governance_convergence_scores` | A | 0 | tenant:organization_id | server:2 |
| `governance_enforcement_events` | A | 0 | tenant:organization_id+actor_user_id | server:5 |
| `incident_events` | A | 0 | control/audit/billing/config | unreferenced |
| `incident_timeline_entries` | A | 0 | tenant:organization_id+actor_user_id; control/audit/billing/config | server:2 |
| `incidents` | A | 0 | control/audit/billing/config | server:3 client:1 |
| `ingestion_throughput_state` | A | 0 | tenant:organization_id | server:1 |
| `integration_activity_events` | A | 144 | tenant:company_id; control/audit/billing/config | server:1 cron:1 api:1 |
| `integration_capabilities` | A | 0 | tenant:organization_id; control/audit/billing/config | server:2 |
| `intelligence_company_overrides` | A | 0 | tenant:company_id; control/audit/billing/config | server:1 |
| `intelligence_execution_log` | A | 0 | tenant:company_id | server:2 api:1 |
| `intelligence_global_config` | A | 16 | control/audit/billing/config | server:1 |
| `intelligence_governance_policies` | A | 0 | tenant:organization_id+created_by; control/audit/billing/config | server:4 |
| `intelligence_incidents` | A | 0 | tenant:organization_id+owner_user_id+created_by; control/audit/billing/config | server:6 |
| `intelligence_role_assignments` | A | 0 | tenant:organization_id+user_id; control/audit/billing/config | server:1 |
| `intelligence_roles` | A | 0 | tenant:organization_id+created_by; control/audit/billing/config | server:1 |
| `intelligence_throttle_config` | A | 1 | control/audit/billing/config | server:1 api:1 |
| `intent_savings_log` | C | 0 | — | server:1 |
| `investigation_workspace_items` | A | 0 | tenant:organization_id | server:2 |
| `investigation_workspaces` | A | 0 | tenant:organization_id+created_by | server:1 |
| `ip_org_creations` | A | 0 | tenant:ip+user_id+organization_id; control/audit/billing/config | unreferenced |
| `job_idempotency_keys` | C | 0 | — | unreferenced |
| `listening_configurations` | A | 0 | tenant:organization_id | server:2 |
| `listening_executions` | A | 0 | tenant:organization_id+created_by | server:18 |
| `listening_signal_dedup` | A | 0 | tenant:organization_id | server:2 |
| `listening_sources` | A | 0 | tenant:organization_id+created_by | server:6 |
| `llm_models` | C | 2 | — | server:2 api:1 |
| `llm_providers` | C | 1 | — | server:2 api:2 |
| `market_pulse_automation_settings` | A | 0 | tenant:company_id | server:2 cron:1 |
| `market_pulse_finding_actions` | A | 0 | tenant:company_id | api:3 |
| `market_pulse_findings` | A | 78 | tenant:company_id | server:10 api:4 |
| `market_pulse_memory` | A | 50 | tenant:company_id | server:5 |
| `market_pulse_runs` | A | 17 | tenant:company_id | server:8 api:4 |
| `migration_dry_runs` | A | 0 | tenant:organization_id | server:3 |
| `moderation_decisions` | A | 0 | tenant:organization_id | server:8 |
| `monetization_beta_drills` | A | 0 | tenant:organization_id; control/audit/billing/config | server:1 |
| `monetization_beta_orgs` | A | 0 | tenant:organization_id; control/audit/billing/config | server:1 |
| `monetization_beta_support_actions` | A | 0 | tenant:actor_user_id+organization_id; control/audit/billing/config | server:2 |
| `monetization_beta_support_cases` | A | 0 | tenant:organization_id; control/audit/billing/config | server:1 |
| `monetization_beta_users` | A | 0 | tenant:user_id+organization_id; control/audit/billing/config | server:1 |
| `monitoring_runs` | A | 0 | tenant:organization_id | server:1 |
| `observability_convergence_projections` | A | 0 | tenant:organization_id | server:1 |
| `operational_safety_rail_events` | A | 0 | tenant:organization_id+actor_user_id | server:2 |
| `operational_safety_rails` | A | 0 | tenant:organization_id | server:4 |
| `operator_actions` | A | 0 | tenant:organization_id+actor_user_id; control/audit/billing/config | server:3 |
| `opportunity_assignments` | A | 0 | tenant:organization_id | server:1 |
| `opportunity_dispositions` | A | 0 | tenant:organization_id | server:1 |
| `opportunity_feed_items` | A | 0 | tenant:organization_id | server:14 script:2 |
| `opportunity_graph_edges` | A | 0 | tenant:organization_id | server:2 |
| `opportunity_graph_nodes` | A | 0 | tenant:organization_id | server:4 |
| `opportunity_lifecycle_states` | A | 0 | tenant:organization_id+actor_user_id | server:4 |
| `opportunity_notes` | A | 0 | tenant:organization_id | server:3 |
| `opportunity_tags` | A | 0 | tenant:organization_id+created_by | server:1 |
| `org_learning_metrics` | A | 0 | tenant:organization_id | server:1 |
| `pending_invite_unlocks` | A | 0 | control/audit/billing/config | unreferenced |
| `platform_cost_allocations` | A | 0 | tenant:organization_id; control/audit/billing/config | unreferenced |
| `platform_cost_categories` | A | 0 | control/audit/billing/config | unreferenced |
| `platform_stabilization_events` | A | 0 | tenant:organization_id+actor_user_id | server:1 |
| `platform_stabilization_windows` | A | 0 | tenant:organization_id | server:2 |
| `post_analytics_polls` | A | 4 | tenant:company_id+user_id | server:2 |
| `post_events` | A | 0 | tenant:company_id+user_id | api:1 |
| `production_certification_reports` | A | 0 | tenant:organization_id | server:1 |
| `production_rollout_plans` | A | 0 | tenant:organization_id+owner_user_id | server:7 |
| `production_rollout_stage_executions` | A | 0 | tenant:organization_id | server:1 |
| `projection_sync_state` | A | 0 | tenant:organization_id | server:8 |
| `provider_invoice_imports` | A | 0 | control/audit/billing/config | server:6 |
| `referrals` | A | 0 | control/audit/billing/config | api:3 |
| `region_routing` | A | 0 | tenant:organization_id; control/audit/billing/config | server:2 |
| `replay_operations` | A | 0 | tenant:organization_id | worker:1 server:5 |
| `replay_partitions` | A | 0 | tenant:organization_id | server:10 |
| `report_automation_configs` | A | 5 | tenant:user_id+company_id | server:1 api:2 |
| `report_automation_events` | A | 0 | tenant:user_id+company_id | server:1 api:2 |
| `report_definitions` | A | 0 | tenant:organization_id+owner_user_id | server:1 |
| `report_executions` | A | 0 | tenant:organization_id | server:1 |
| `report_notification_events` | A | 4 | tenant:user_id+company_id | server:1 api:1 |
| `resilience_advisory_plans` | A | 0 | tenant:organization_id | server:1 |
| `resilience_validation_runs` | A | 0 | tenant:organization_id | server:3 |
| `retention_executions` | A | 0 | tenant:organization_id | server:2 |
| `retention_policies` | A | 0 | tenant:organization_id+created_by | server:1 |
| `saved_intelligence_views` | A | 0 | tenant:organization_id+owner_user_id | server:1 |
| `semantic_index_entries` | A | 0 | tenant:organization_id | server:2 |
| `semantic_indexing_jobs` | A | 0 | tenant:organization_id | worker:1 server:2 |
| `semantic_indexing_partitions` | A | 0 | tenant:organization_id | worker:1 server:7 |
| `semantic_retrieval_explanations` | A | 0 | tenant:organization_id | server:1 |
| `signal_intent_clusters` | A | 0 | tenant:organization_id | server:3 |
| `sla_breaches` | A | 0 | tenant:organization_id | server:1 |
| `source_health_states` | A | 0 | tenant:organization_id | server:4 |
| `sre_health_snapshots` | A | 0 | tenant:organization_id | server:2 |
| `support_snapshots` | A | 0 | tenant:organization_id | server:3 |
| `system_anomalies` | C | 844 | — | server:1 api:1 |
| `system_health_metrics` | C | 646855 | — | server:2 api:1 |
| `tenant_onboarding_runtime_stages` | A | 0 | tenant:organization_id | server:2 |
| `token_refresh_locks` | A | 0 | control/audit/billing/config | server:1 |
| `unified_person_merges` | A | 0 | tenant:company_id | script:3 |
| `whatsapp_broadcast_recipients` | A | 0 | CRED:encrypted_phone; control/audit/billing/config | server:1 api:1 |
| `whatsapp_broadcasts` | A | 0 | tenant:company_id+created_by; control/audit/billing/config | server:1 api:3 script:1 |
| `whatsapp_media_cache` | A | 0 | tenant:company_id; control/audit/billing/config | unreferenced |
| `whatsapp_templates` | A | 0 | tenant:company_id; control/audit/billing/config | server:1 api:1 |

## 4. Functions and views

### 4.1 SECURITY DEFINER functions (29) → `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`; `GRANT EXECUTE TO service_role`

| function | caller check in body | code callers (all service-role) |
|---|---|---|
| `activate_invitation_membership(uuid,uuid,timestamp with time zone)` | **none** | pages/api/auth/set-password.ts |
| `admin_override_community_ai_status(uuid,text,text,uuid)` | auth.role() | no code caller |
| `apply_credit_transaction_v2(uuid,text,integer,numeric,text,text,text,uuid,text,text,uuid,text,jsonb)` | **none** | no code caller |
| `auth_user_confirmed(text)` | **none** | pages/api/auth/{login,signup,magic-link}.ts, superAdmin usersCreateShared |
| `auth_user_has_password(uuid)` | **none** | pages/api/auth/{login,sync-supabase-user}.ts, authDiagnostics |
| `claim_email_jobs(text,integer)` | **none** | pages/api/cron/email-jobs.ts |
| `configure_domain_reminder_cron(text,text)` | **none** | no code caller |
| `delete_intelligence_signals_older_than_365_days()` | **none** | intelligenceSignalStore |
| `disable_company_cascade(uuid,uuid,text)` | **none** | lifecycleGovernance |
| `finalize_email_job(uuid,text,text,text,timestamp with time zone)` | **none** | cron/email-jobs, invitations resend |
| `flush_community_ai_metric_dlq(integer)` | **none** | communityAiAction* |
| `get_usage_report(uuid,uuid,text,text,text,text,timestamp with time zone,timestamp with time zone,boolean)` | **none** | pages/api/super-admin/usage-report.ts |
| `image_metadata_append_query(text[],text)` | **none** | backend/db/imageMetadataStore.ts |
| `increment_automation_usage_if_allowed(uuid,integer)` | **none** | automationService |
| `increment_bolt_run_progress(uuid,integer,integer,integer,integer)` | **none** | boltContentJobProcessor (worker) |
| `increment_usage_meter(uuid,integer,integer,bigint,bigint,bigint,bigint,bigint,numeric)` | **none** | usageMeterService |
| `invalidate_user_sessions(uuid,text)` | **none** | lifecycleGovernance |
| `meta_oauth_apply(jsonb,jsonb,jsonb,jsonb)` | **none** | no code caller |
| `omnivyra_upsert_behavioral_analytics(jsonb,jsonb)` | **none** | ga4IngestionService |
| `prune_rpa_artifacts(integer)` | **none** | rpaArtifactStore |
| `reap_community_ai_action_leases()` | **none** | backend/scheduler/cron.ts |
| `record_email_event(uuid,text,jsonb,text)` | **none** | emailJobsService, cron/email-jobs |
| `refresh_community_ai_execution_metrics_daily(integer)` | **none** | communityAiActionExecutorContracts |
| `security_create_secret(text,text,text)` | **none** | VaultSecretClient |
| `security_delete_secret(uuid)` | **none** | VaultSecretClient |
| `security_get_secret(uuid)` | **none** | VaultSecretClient |
| `soft_delete_company(uuid,uuid,text)` | **none** | lifecycleGovernance |
| `trigger_domain_reminder_cron()` | **none** | no code caller |
| `trigger_recover_stale_reports_cron()` | **none** | no code caller |

### 4.2 Views

* Owner-rights views (29) → `REVOKE ALL FROM anon, authenticated`: `ai_suggestion_acceptance_rate`, `canonical_campaign_entities`, `canonical_company_entities`, `community_ai_execution_success_rate`, `company_blog_performance_summary`, `company_financial_reconciliation`, `cost_margin_daily_view`, `cost_monitoring_daily_view`, `deep_view`, `free_credits_activity`, `growth_view`, `identity_health_metrics`, `market_pulse_latest_run_view`, `org_economics_view`, `pricing_health_view`, `retention_candidates`, `snapshot_view`, `unified_transactions_with_anomalies_view`, `v_approval_health`, `v_billing_operations_health`, `v_company_financial_timeline`, `v_finance_role_holders`, `v_pricing_catalog`, `v_reservation_health`, `vw_company_report_stats`, `vw_feature_completion_summary`, `vw_free_reports_by_domain`, `weekly_alignment_summary`, `weekly_refinement_status`.
* `security_invoker` views (8) → `REVOKE ALL FROM anon`; writes revoked from authenticated (reads remain subject to the
  underlying tables' RLS): `blog_performance_summary`, `campaign_insights_view`, `community_ai_network_intelligence`, `content_opportunities_view`, `engagement_insights_view`, `lead_intelligence_view`, `market_pulse_view`, `omnivyra_decision_feature_base_view`.

## 5. Policies and intentionally public data

Retargeted `TO service_role` (no anonymous consumer exists; server behaviour unchanged because service_role bypasses RLS;
nothing dropped): `blog_analytics.owner_select`, `blog_analytics.tracker_insert` (the tracker writes through
`pages/api/track.ts` with the service role), `blog_analytics_daily.service_all_daily`, `blog_intelligence_settings.service_all`,
`blog_post_likes."Public read blog likes"` (exposes browser fingerprints), `campaign_design_systems.cds_company_rw`,
`company_blog_read_sessions` insert/update (tenant data; no code path uses it), `creator_template_collections.ctc_company_rw`,
`creator_user_template_versions.cutv_company_rw`, `creator_user_templates.cut_company_rw`.

**Intentionally public, read-only (kept):**

| table | why public | what changes |
|---|---|---|
| `content_type` | the format vocabulary (id, label, family) — reference data, no tenant column, no PII | anon/authenticated writes revoked; SELECT policy kept |
| `blog_series` | published-blog series metadata (title, slug, description, cover) — no tenant column | same |
| `blog_series_posts` | series ↔ post ordering — no tenant column | same |
| `blog_relationships` | related-post links — no tenant column | same |

## 6. TRUNCATE and the root cause for future objects

TRUNCATE is revoked from `anon`/`authenticated` on every public table (it bypasses RLS; no anon/authenticated path uses it).
The migration alters default privileges so objects created by `postgres` in `public` no longer grant anything to
`anon`, no longer grant TRUNCATE to `authenticated`, and new functions are no longer EXECUTE-able by `PUBLIC`.
`service_role` defaults are unchanged. `scripts/check-migration-quality.js` now rejects, for migrations ≥ `20261026000000`: a public `CREATE TABLE`
without `ENABLE ROW LEVEL SECURITY`, a `SECURITY DEFINER` function without `REVOKE EXECUTE … FROM PUBLIC`, and an
unconditional anon/public policy without a `-- rls-public-ok: <reason>` justification.

## 7. Validation (non-production)

* **Local cert Supabase** (identical inventory to production — same 177 tables, 29 function signatures, 37 views):
  exposure reproduced (anon read 177/177, RPC, owner-rights view); after the migration the PostgREST matrix passed **1606/1606**
  (anon/authenticated denied read/insert/update/delete on 177 tables, 29 RPCs, 29 owner-rights views; service_role reads 177
  tables + 37 views and calls RPC; public tables readable, not writable; authenticated `credit_transactions` read works);
  SQL matrix: SELECT/UPDATE/DELETE/TRUNCATE denied 177/177 for both roles, INSERT denied (173 by SQL, 4 generated-column
  tables by catalog + REST); service_role full INSERT/SELECT/UPDATE/DELETE cycle on RLS tables (rolled back).
* Idempotent (second apply byte-identical); rollback restores the exact pre-state (ACL-order-normalised diff = 0);
  5/5 negative controls make the self-check abort.
* Real-schema replay (`scripts/ci/real-schema-ci.sh`): migration replays cleanly onto the baseline; 25 suites / 451 tests pass,
  including `backend/tests/realschema/rls_anon_exposure.test.ts`.

## 8. Production verification plan (Track F)

`node scripts/security/verify-anon-exposure.js --expect before|after` (read-only session; anonymous probes are GET/HEAD
count-only with the publishable key; functions are checked from the catalog, never called). The exact SQL is in
`scripts/security/verify-anon-exposure.sql`.

* **Before** (run 2026-09-14): 20/20 checks confirm the exposure — RLS on 0/177; anon privileges on 177/177; definer
  functions executable by anon 29/29; views readable by anon 37/37; policies on `{public}` 11/11; anon-readable RLS-off
  tables 177; TRUNCATE held on 835 tables; default ACL grants anon; REST readable 213/214.
* **After** (expected): RLS on 177/177; anon and authenticated privileges 0; definer functions 0 for anon/authenticated and 29
  for service_role; views 0 for anon; 11/11 policies on service_role; public tables readable and not writable;
  `credit_transactions` path intact; 0 RLS-off anon-readable tables anywhere; TRUNCATE held on 0 tables; default ACL clean; ledger row present;
  REST readable 0 of 214; public tables 4/4 readable.

## 9. Apply procedure (requires explicit authorization — not performed)

1. `node scripts/security/verify-anon-exposure.js --expect before` → all PASS.
2. `psql -1 -v ON_ERROR_STOP=1 -c "SET lock_timeout = '15s'" -f supabase/migrations/20261026000000_close_anon_rls_exposure.sql
   -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261026000000', 'close_anon_rls_exposure')"`
   (never `supabase db push`). A lock timeout rolls everything back; re-run.
3. `node scripts/security/verify-anon-exposure.js --expect after` → all PASS; then application smoke tests.
4. Rollback (restores service, re-opens the exposure): `supabase/migrations/rollbacks/close_anon_rls_exposure_rollback.sql`.
