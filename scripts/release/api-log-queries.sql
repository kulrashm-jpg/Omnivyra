-- ============================================================================
-- api-log-queries.sql — Supabase Logs Explorer / Management API analytics
-- queries: did any caller OTHER than a verified service_role key reach an
-- object whose grants are in scope?
--
-- FOR AN AUTHORIZED OPERATOR ONLY. These run against the production project's
-- log store (Logs Explorer in the dashboard, or the Management API analytics
-- endpoint). They were NOT run by the author — no production or log access was
-- used to prepare them — and they have NOT been executed anywhere: the Logs
-- Explorer dialect (BigQuery-style SQL over edge_logs / realtime_logs /
-- postgres_logs) cannot be validated on a local PostgreSQL. Field paths
-- (metadata.request.sb.jwt.*, request.search, request.headers.*) follow
-- Supabase's documented log schema at the time of writing; every path marked
-- TO CONFIRM must be checked in the Logs Explorer schema pane before trusting a
-- zero. A query that errors or returns NULL in a confirmed field is a schema
-- mismatch, not evidence.
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
--     below do), and slice the retention window into consecutive day windows.
--   * EXPLICIT SLICE BOUNDS: every query carries the placeholders
--     <SLICE_START_ISO> / <SLICE_END_ISO> (e.g. 2026-10-01T00:00:00Z). Replace
--     both before running — the query is deliberately invalid until you do —
--     and save the exact SQL text you ran with each slice's start, end, HTTP
--     status and row count (including zero). A slice is reproducible only from
--     its saved SQL.
--   * KEY CLASSIFICATION: the server uses the opaque `sb_secret_…` key and the
--     browser the opaque `sb_publishable_…` key (backend/db/supabaseKeys.ts).
--     Neither is a JWT, so neither carries a role payload: the role column is
--     NULL for both unless a user JWT rides along. NULL is therefore reported
--     as `unknown-key` — NEVER as anon and NEVER as service_role. Use the
--     user_agent / x_client_info columns (and the key-type field if the schema
--     pane shows one — TO CONFIRM) to tell server traffic from other callers;
--     an unknown-key row that cannot be attributed is an open consumer question.
--   * RESOURCE EMBEDDING: PostgREST can reach an in-scope table through another
--     path (`/rest/v1/<other>?select=*,content_quality(*)`), and views/RPCs can
--     read in-scope tables. Q1/Q2 therefore also match the query string
--     (`request.search`, TO CONFIRM). A view/function that reads an in-scope
--     table is found with grants-acl-check.sql S12 (dependencies), not here.
--   * Realtime (websocket) traffic is NOT in edge_logs; Q4 covers realtime_logs,
--     which records channel joins/errors, not every postgres_changes delivery.
--   * Direct database clients (psql, pooler URLs in scripts/workers, BI tools,
--     pg_cron) never pass the API gateway and are ABSENT from edge_logs. Q5
--     (postgres_logs) sees only what Postgres logged (errors, and statements
--     only if statement logging is on); Q5b sees connections only if
--     `log_connections` is on — record that setting with the result.
--     `authenticator` is the PostgREST/Realtime pool login and carries
--     service_role traffic too: it is NOT evidence of a client-role consumer.
--   * pg_graphql (/graphql/v1) exposes the same tables under the same grants;
--     Q3 covers it.
--   * Storage (/storage/v1) is out of scope: it serves objects from the storage
--     schema, not the in-scope public tables. It matters only if a storage
--     policy references an in-scope table — checked by grants-acl-check.sql S12,
--     not by these logs.
--   * Logs are sampled/truncated by the platform under load (confirm).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Q1. ALL non-service_role REST/RPC traffic, aggregated per object × key ×
--     client × day. The broadest net: compare `object` and `embedded` offline
--     against the full in-scope list (matrix §1).
-- ---------------------------------------------------------------------------
select
  timestamp_trunc(cast(t.timestamp as timestamp), day) as day,
  regexp_extract(request.path, r'^/rest/v1/(?:rpc/)?([^/?]+)') as object,
  starts_with(request.path, '/rest/v1/rpc/') as is_rpc,
  regexp_contains(coalesce(request.search, ''), r'select=[^&]*\(') as embedded,    -- request.search: TO CONFIRM
  request.method as method,
  coalesce(auth_payload.role, apikey_payload.role, 'unknown-key') as key_role,
  request.headers[safe_offset(0)].user_agent as user_agent,                       -- TO CONFIRM
  request.headers[safe_offset(0)].x_client_info as x_client_info,                 -- TO CONFIRM
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
where cast(t.timestamp as timestamp) >= timestamp '<SLICE_START_ISO>'
  and cast(t.timestamp as timestamp) <  timestamp '<SLICE_END_ISO>'
  and starts_with(request.path, '/rest/v1/')
  and coalesce(auth_payload.role, apikey_payload.role, 'unknown-key') != 'service_role'
group by day, object, is_rpc, embedded, method, key_role, user_agent, x_client_info, status
order by day, object, key_role, status;


-- ---------------------------------------------------------------------------
-- Q2. Focused: any non-service_role request whose PATH or QUERY STRING names an
--     in-scope object (stack, FIX3 + 8 Phase-A, PR #349, stack RPCs). The
--     query-string match catches resource embedding. Any row is a consumer to
--     identify before an explicit REVOKE.
-- ---------------------------------------------------------------------------
select
  cast(t.timestamp as timestamp) as ts,
  request.method as method,
  request.path as path,
  request.search as search,                                                     -- TO CONFIRM
  coalesce(auth_payload.role, apikey_payload.role, 'unknown-key') as key_role,
  auth_payload.sub as jwt_sub,
  response.status_code as status,
  request.headers[safe_offset(0)].user_agent as user_agent,                       -- TO CONFIRM
  request.headers[safe_offset(0)].x_client_info as x_client_info                  -- TO CONFIRM
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
where cast(t.timestamp as timestamp) >= timestamp '<SLICE_START_ISO>'
  and cast(t.timestamp as timestamp) <  timestamp '<SLICE_END_ISO>'
  and starts_with(request.path, '/rest/v1/')
  and (
    regexp_contains(
      request.path,
      r'^/rest/v1/(rpc/)?(prospect_lists|prospect_list_members|prospect_campaigns|prospect_campaign_lists|prospect_campaign_targets|workflows|workflow_versions|execution_instances|execution_plans|execution_plan_steps|execution_tasks|outreach_bridge_handoffs|execution_engine_requests|community_action_journey_links|rpa_auth_token_redemptions|identity_verification_attestations|engagement_request_idempotency|rpa_session_invalidation_audit|customer_readiness_snapshots|execution_approvals|content|content_asset|content_variant|content_revision|content_memory|content_originality|brand_memory|publication_lineage|content_quality|content_block|content_recommendation|content_approval_history|create_execution_instance|create_execution_plan|execution_step_anchor|advance_execution_plan|cancel_execution_run|bridge_execution_task|publish_workflow_version|reap_community_ai_action_leases|claim_community_ai_browser_command|record_community_ai_late_dispatch_result|community_identity_normalize_external_id)([/?]|$)')
    or regexp_contains(
      coalesce(request.search, ''),
      r'(^|[=,(])(?:[a-z_]+:)?(prospect_lists|prospect_list_members|prospect_campaigns|prospect_campaign_lists|prospect_campaign_targets|workflows|workflow_versions|execution_instances|execution_plans|execution_plan_steps|execution_tasks|outreach_bridge_handoffs|execution_engine_requests|community_action_journey_links|rpa_auth_token_redemptions|identity_verification_attestations|engagement_request_idempotency|rpa_session_invalidation_audit|customer_readiness_snapshots|execution_approvals|content|content_asset|content_variant|content_revision|content_memory|content_originality|brand_memory|publication_lineage|content_quality|content_block|content_recommendation|content_approval_history)(!|\(|,|$)')
  )
  and coalesce(auth_payload.role, apikey_payload.role, 'unknown-key') != 'service_role'
order by ts
limit 1000;
-- If the result hits the limit, narrow the time slice — never read a capped
-- result as complete.


-- ---------------------------------------------------------------------------
-- Q3. pg_graphql: same grants, different endpoint. Bodies are not logged, so
--     only volume by key and client is observable; any non-service_role row
--     means a GraphQL consumer exists and its queries must be identified
--     elsewhere.
-- ---------------------------------------------------------------------------
select
  timestamp_trunc(cast(t.timestamp as timestamp), day) as day,
  coalesce(auth_payload.role, apikey_payload.role, 'unknown-key') as key_role,
  request.headers[safe_offset(0)].user_agent as user_agent,                       -- TO CONFIRM
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
where cast(t.timestamp as timestamp) >= timestamp '<SLICE_START_ISO>'
  and cast(t.timestamp as timestamp) <  timestamp '<SLICE_END_ISO>'
  and starts_with(request.path, '/graphql/v1')
group by day, key_role, user_agent, status
order by day;


-- ---------------------------------------------------------------------------
-- Q4. Realtime. The only browser subscription in the code base is
--     postgres_changes on public.credit_transactions (lib/swr/creditsRealtime.ts).
--     Look for channel joins / errors naming an in-scope table (exact names,
--     word-bounded). Pair with grants-acl-check.sql S09 (pg_publication_tables):
--     a table in no publication cannot deliver postgres_changes at all — the
--     publication list is the stronger evidence; this query is supporting.
-- ---------------------------------------------------------------------------
select
  cast(t.timestamp as timestamp) as ts,
  t.event_message
from realtime_logs as t
where cast(t.timestamp as timestamp) >= timestamp '<SLICE_START_ISO>'
  and cast(t.timestamp as timestamp) <  timestamp '<SLICE_END_ISO>'
  and regexp_contains(
        t.event_message,
        r'\b(prospect_lists|prospect_list_members|prospect_campaigns|prospect_campaign_lists|prospect_campaign_targets|workflows|workflow_versions|execution_instances|execution_plans|execution_plan_steps|execution_tasks|outreach_bridge_handoffs|execution_engine_requests|community_action_journey_links|rpa_auth_token_redemptions|identity_verification_attestations|engagement_request_idempotency|rpa_session_invalidation_audit|customer_readiness_snapshots|execution_approvals|content|content_asset|content_variant|content_revision|content_memory|content_originality|brand_memory|publication_lineage|content_quality|content_block|content_recommendation|content_approval_history|credit_transactions)\b')
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
where cast(t.timestamp as timestamp) >= timestamp '<SLICE_START_ISO>'
  and cast(t.timestamp as timestamp) <  timestamp '<SLICE_END_ISO>'
  and (regexp_contains(t.event_message, r'permission denied for (table|function|view|sequence)')
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
where cast(t.timestamp as timestamp) >= timestamp '<SLICE_START_ISO>'
  and cast(t.timestamp as timestamp) <  timestamp '<SLICE_END_ISO>'
  and parsed.user_name in ('anon', 'authenticated')
group by 1, 2
order by log_lines desc;
-- `authenticator` is deliberately excluded: it is the pool login for ALL
-- PostgREST/Realtime traffic (service_role included) and proves nothing.


-- ---------------------------------------------------------------------------
-- Q5b. Direct database logins: who connects to Postgres outside the API
--      gateway (BI tools, scripts, workers, psql users). Returns rows ONLY if
--      `log_connections` is on — record `SHOW log_connections` (read-only) with
--      the result; with it off, an empty result is NOT evidence.
-- ---------------------------------------------------------------------------
select
  parsed.user_name,
  parsed.application_name,
  parsed.connection_from,                                                       -- TO CONFIRM
  count(*) as connections
from postgres_logs as t
  cross join unnest(t.metadata) as m
  cross join unnest(m.parsed) as parsed
where cast(t.timestamp as timestamp) >= timestamp '<SLICE_START_ISO>'
  and cast(t.timestamp as timestamp) <  timestamp '<SLICE_END_ISO>'
  and (t.event_message like 'connection authorized%' or t.event_message like 'connection received%')
group by 1, 2, 3
order by connections desc;


-- ---------------------------------------------------------------------------
-- MANAGEMENT API (same SQL, scripted day slices) — operator-held token only:
--   GET https://api.supabase.com/v1/projects/<project-ref>/analytics/endpoints/logs.all
--       ?sql=<url-encoded query>&iso_timestamp_start=<slice start>&iso_timestamp_end=<slice end>
--   Substitute the same slice bounds into the SQL text AND the query
--   parameters. Iterate consecutive slices from (now - retention) to now;
--   confirm the endpoint's maximum window per call and rate limits before
--   scripting. Store every slice's request window, HTTP status and row count.
--   Never print the token; never write responses containing JWT subjects or
--   user agents to a shared location without review.
-- ---------------------------------------------------------------------------
