-- ============================================================================
-- api-log-queries.sql — Supabase Logs Explorer / Management API analytics
-- queries: did any USER-TOKEN caller (anon / authenticated, i.e. NOT
-- service_role) reach an object whose grants are in scope?
--
-- FOR AN AUTHORIZED OPERATOR ONLY. These run against the production project's
-- log store (Logs Explorer in the dashboard, or the Management API analytics
-- endpoint). They were NOT run by the author — no production or log access was
-- used to prepare them — and they have NOT been executed anywhere: the Logs
-- Explorer dialect (BigQuery-style SQL over edge_logs / realtime_logs /
-- postgres_logs) cannot be validated on a local PostgreSQL. Field paths
-- (metadata.request.sb.jwt.*) follow Supabase's documented log schema at the
-- time of writing; open the Logs Explorer schema pane and confirm each path
-- before trusting a zero. A query that errors or returns NULL roles is a
-- schema mismatch, not evidence.
--
-- Scope and object list: docs/release/grants-consumer-matrix.md §1.
--
-- ===================== READ THIS BEFORE USING THE RESULTS ===================
--   ZERO HITS DO NOT PROVE ABSENCE OF CONSUMERS.
--   * Retention is plan-bound (at authoring: Free 1 day, Pro 7 days, Team 28
--     days, Enterprise 90 days — confirm on the project's plan). A consumer that
--     runs monthly, quarterly or on demand can be outside the window entirely.
--   * Logs Explorer and the analytics endpoint cap rows per result and the time
--     range per call (confirm current limits). Always AGGREGATE (the queries
--     below do), and slice the retention window into consecutive day windows;
--     record every slice's start/end and row count, including zero.
--   * Publishable-key requests WITHOUT a user JWT: the new `sb_publishable_…`
--     keys are not JWTs, so the request carries no role payload; such requests
--     run as `anon`. They appear below with role NULL / 'anon' depending on
--     how the gateway records them — treat NULL-role rows as anon candidates,
--     never as service_role.
--   * Realtime (websocket) traffic is NOT in edge_logs; Q4 covers realtime_logs,
--     which records channel joins/errors, not every postgres_changes delivery.
--   * Direct database clients (psql, pooler URLs in scripts/workers, BI tools,
--     pg_cron) never pass the API gateway and are ABSENT from edge_logs. Q5
--     (postgres_logs) sees only what Postgres logged (errors, and statements
--     only if statement logging is on).
--   * pg_graphql (/graphql/v1) exposes the same tables under the same grants;
--     Q3 covers it.
--   * Logs are sampled/truncated by the platform under load (confirm).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Q1. ALL user-token REST/RPC traffic, aggregated per object × role × day.
--     The broadest net: compare the `object` column offline against the full
--     in-scope list (matrix §1). Run once per day slice over the retention
--     window. service_role rows are excluded on purpose.
-- ---------------------------------------------------------------------------
select
  timestamp_trunc(cast(t.timestamp as timestamp), day) as day,
  regexp_extract(request.path, r'^/rest/v1/(?:rpc/)?([^/?]+)') as object,
  starts_with(request.path, '/rest/v1/rpc/') as is_rpc,
  request.method as method,
  coalesce(auth_payload.role, apikey_payload.role) as jwt_role,
  response.status_code as status,
  count(*) as requests
from edge_logs as t
  cross join unnest(t.metadata) as m
  cross join unnest(m.request) as request
  cross join unnest(m.response) as response
  left join unnest(request.sb) as sb on true
  left join unnest(sb.jwt) as jwt on true
  left join unnest(jwt.authorization) as auth on true
  left join unnest(auth.payload) as auth_payload on true
  left join unnest(jwt.apikey) as apikey on true
  left join unnest(apikey.payload) as apikey_payload on true
where starts_with(request.path, '/rest/v1/')
  and coalesce(auth_payload.role, apikey_payload.role, 'NULL-role') != 'service_role'
group by day, object, is_rpc, method, jwt_role, status
order by day, object, jwt_role, status;


-- ---------------------------------------------------------------------------
-- Q2. Focused: the objects whose grants are open or recently changed
--     (stack, FIX3 + 8 Phase-A, PR #349, and the stack RPCs). Any row here is
--     a consumer to identify before an explicit REVOKE. Day-slice as Q1.
-- ---------------------------------------------------------------------------
select
  cast(t.timestamp as timestamp) as ts,
  request.method as method,
  request.path as path,
  coalesce(auth_payload.role, apikey_payload.role) as jwt_role,
  auth_payload.sub as jwt_sub,
  response.status_code as status,
  request.headers[safe_offset(0)].user_agent as user_agent
from edge_logs as t
  cross join unnest(t.metadata) as m
  cross join unnest(m.request) as request
  cross join unnest(m.response) as response
  left join unnest(request.sb) as sb on true
  left join unnest(sb.jwt) as jwt on true
  left join unnest(jwt.authorization) as auth on true
  left join unnest(auth.payload) as auth_payload on true
  left join unnest(jwt.apikey) as apikey on true
  left join unnest(apikey.payload) as apikey_payload on true
where regexp_contains(
        request.path,
        r'^/rest/v1/(rpc/)?(prospect_lists|prospect_list_members|prospect_campaigns|prospect_campaign_lists|prospect_campaign_targets|workflows|workflow_versions|execution_instances|execution_plans|execution_plan_steps|execution_tasks|outreach_bridge_handoffs|execution_engine_requests|community_action_journey_links|rpa_auth_token_redemptions|identity_verification_attestations|engagement_request_idempotency|rpa_session_invalidation_audit|customer_readiness_snapshots|execution_approvals|content|content_asset|content_variant|content_revision|content_memory|content_originality|brand_memory|publication_lineage|content_quality|content_block|content_recommendation|content_approval_history|create_execution_instance|create_execution_plan|execution_step_anchor|advance_execution_plan|cancel_execution_run|bridge_execution_task|publish_workflow_version|reap_community_ai_action_leases|claim_community_ai_browser_command|record_community_ai_late_dispatch_result|community_identity_normalize_external_id)([/?]|$)')
  and coalesce(auth_payload.role, apikey_payload.role, 'NULL-role') != 'service_role'
order by ts
limit 1000;
-- If the result hits the limit, narrow the time slice — never read a capped
-- result as complete.


-- ---------------------------------------------------------------------------
-- Q3. pg_graphql: same grants, different endpoint. Bodies are not logged, so
--     only volume by role is observable; any non-service_role row means a
--     GraphQL consumer exists and its queries must be identified elsewhere.
-- ---------------------------------------------------------------------------
select
  timestamp_trunc(cast(t.timestamp as timestamp), day) as day,
  coalesce(auth_payload.role, apikey_payload.role) as jwt_role,
  response.status_code as status,
  count(*) as requests
from edge_logs as t
  cross join unnest(t.metadata) as m
  cross join unnest(m.request) as request
  cross join unnest(m.response) as response
  left join unnest(request.sb) as sb on true
  left join unnest(sb.jwt) as jwt on true
  left join unnest(jwt.authorization) as auth on true
  left join unnest(auth.payload) as auth_payload on true
  left join unnest(jwt.apikey) as apikey on true
  left join unnest(apikey.payload) as apikey_payload on true
where starts_with(request.path, '/graphql/v1')
group by day, jwt_role, status
order by day;


-- ---------------------------------------------------------------------------
-- Q4. Realtime. The only browser subscription in the code base is
--     postgres_changes on public.credit_transactions (lib/swr/creditsRealtime.ts).
--     Look for channel joins / errors that mention any in-scope table. Pair
--     with grants-acl-check.sql S09 (pg_publication_tables): a table that is
--     in no publication cannot deliver postgres_changes at all.
-- ---------------------------------------------------------------------------
select
  cast(t.timestamp as timestamp) as ts,
  t.event_message
from realtime_logs as t
where regexp_contains(
        t.event_message,
        r'(prospect_|workflow|execution_|outreach_bridge|community_action_journey|rpa_|identity_verification|engagement_request|customer_readiness|content|brand_memory|publication_lineage|credit_transactions|postgres_changes)')
order by ts
limit 1000;


-- ---------------------------------------------------------------------------
-- Q5. Postgres-side evidence (covers direct DB clients only when Postgres logs
--     them): permission errors on in-scope objects, and sessions logged in as
--     a client role. Run BEFORE a revoke (baseline) and AFTER it (breakage).
-- ---------------------------------------------------------------------------
select
  cast(t.timestamp as timestamp) as ts,
  parsed.user_name,
  parsed.application_name,
  parsed.error_severity,
  t.event_message
from postgres_logs as t
  cross join unnest(t.metadata) as m
  cross join unnest(m.parsed) as parsed
where (regexp_contains(t.event_message, r'permission denied for (table|function|view|sequence)')
       or regexp_contains(t.event_message, r'row-level security'))
order by ts
limit 1000;

select
  parsed.user_name,
  parsed.application_name,
  count(*) as log_lines
from postgres_logs as t
  cross join unnest(t.metadata) as m
  cross join unnest(m.parsed) as parsed
where parsed.user_name in ('anon', 'authenticated', 'authenticator')
group by 1, 2
order by log_lines desc;


-- ---------------------------------------------------------------------------
-- MANAGEMENT API (same SQL, scripted day slices) — operator-held token only:
--   GET https://api.supabase.com/v1/projects/<project-ref>/analytics/endpoints/logs.all
--       ?sql=<url-encoded query>&iso_timestamp_start=<slice start>&iso_timestamp_end=<slice end>
--   Iterate consecutive slices from (now - retention) to now; confirm the
--   endpoint's maximum window per call and rate limits before scripting. Store
--   every slice's request window, HTTP status and row count. Never print the
--   token; never write responses containing JWT subjects or user agents to a
--   shared location without review.
-- ---------------------------------------------------------------------------
