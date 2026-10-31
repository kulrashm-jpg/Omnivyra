-- ============================================================================
-- SECURITY — canonical_leads / canonical_users: revoke client-role privileges
-- STEP SEC-A1 · prepared 2026-10-31 · NOT YET APPLIED TO PRODUCTION
-- ============================================================================
--
-- WHAT IS THERE TODAY (read-only production evidence, 2026-10-30T20:12Z)
--   Both tables have RLS ENABLED (canonical_leads also FORCED) and carry
--     anon=arwdxtm, authenticated=arwdxtm, service_role=arwdDxtm
--   i.e. SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/MAINTAIN for the two
--   client roles. 20261026000000 (3AH-70) revoked TRUNCATE but deliberately left
--   RLS-on tables alone. Their policies are all `TO public`:
--     <t>_select/_update/_delete USING (company_id = current_company_id())
--     <t>_insert/_update WITH CHECK (company_id = current_company_id())
--     service_role_full_access ALL USING/CHECK (auth.role() = 'service_role')
--   current_company_id() returns the TOP-LEVEL JWT claim `company_id` when it is
--   a UUID, else NULL.
--
-- WHY THIS IS NOT AN ACTIVE LEAK, AND WHY IT IS STILL CLOSED
--   No token a client can hold carries a top-level `company_id`: Supabase Auth
--   does not emit one, no access-token hook exists in the database, and nothing
--   in this repository mints Supabase JWTs. user_metadata IS user-writable, but it
--   is nested (`user_metadata.company_id`) and current_company_id() ignores it. So
--   for every real anon/authenticated request current_company_id() is NULL and the
--   tenant policies match nothing (proven on a real PG 17.6 recreation: 0 rows
--   visible, every write refused or a no-op).
--   The grants are nevertheless pure latent exposure: the only thing between
--   every tenant's prospect records and any holder of the publishable key is a
--   JWT claim that nobody issues today. Adding a custom access-token hook that
--   puts `company_id` at the top level (a routine Supabase pattern) would, with
--   no further change, give every signed-in member direct PostgREST
--   read/insert/update/delete on their tenant's canonical_leads/canonical_users,
--   bypassing every server-side validation, RBAC and provenance path, plus an
--   upsert existence oracle on other tenants' ids. The service_role_full_access
--   policy also trusts the `role` CLAIM rather than the database role.
--
-- WHY THIS CANNOT BREAK THE APPLICATION (audited on main b20278de)
--   * Every reader/writer of these tables uses the service-role client
--     (backend/db/supabaseClient.ts via ownedDbTable / supabase.from):
--     crmIngestionService, ga4IngestionService, prospectIdentity/*,
--     prospectProvenance/*, prospectLifecycle/*, leadIntelligence*, ingestionScheduler,
--     distribution/advancedRevenueAttribution services, prospectScoreEvaluationJob,
--     pages/api/analytics/system-state.ts. service_role has BYPASSRLS and keeps its
--     privileges (re-asserted explicitly below).
--   * The browser performs no direct table/RPC access (lib/supabaseBrowser.ts is
--     used for Auth plus one realtime channel on credit_transactions).
--   * Neither table is in a realtime publication, no view depends on either, and
--     the only client-executable function touching them, merge_unified_persons
--     (SECURITY INVOKER), already fails for client roles (unified_persons is
--     invisible to them) and has no application caller.
--   * FK / ON DELETE CASCADE actions run as the table owner, not the caller.
--
-- WHAT THIS DOES (smallest safe change)
--   1. REVOKE ALL ON both tables FROM PUBLIC, anon, authenticated.
--   2. GRANT SELECT, INSERT, UPDATE, DELETE TO service_role (explicit; a no-op on
--      production, which already holds arwdDxtm).
--   Policies are NOT touched: without a table privilege they are unreachable for
--   client roles, and leaving them avoids churn in the governed policy set.
--   The same grant+policy pattern on the other current_company_id() tables
--   (action_registry, campaigns, canonical_domains, canonical_page_views,
--   canonical_pages, canonical_revenue_events, canonical_sessions,
--   data_source_status, decision_events, decision_objects) is out of scope here.
--
-- REPLAY SAFETY
--   Idempotent: REVOKE/GRANT are re-runnable; the preflight asserts only
--   structure, never the pre-change ACL, so it passes on the ACL-free baseline,
--   on production, and on a second run.
--
-- APPLY  (after explicit authorization only)
--   *** DO NOT RUN `supabase db push`. *** Apply by hand per
--   docs/migration-discipline.md (psql -v ON_ERROR_STOP=1). This file opens its
--   own transaction; any failed assertion rolls everything back. REVOKE/GRANT take
--   a brief lock on the table's catalog row only. Record the ledger row as a
--   separate, approved step after verification.
-- ROLLBACK
--   supabase/migrations/rollbacks/canonical_leads_users_client_privileges_revoked_rollback.sql
--   restores production's previous ACL exactly. It re-opens the latent exposure.
-- ============================================================================

BEGIN;

DO $preflight$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'SEC-A1 preflight: role service_role missing or not BYPASSRLS; refusing to remove client access';
  END IF;
  FOREACH t IN ARRAY ARRAY['canonical_leads', 'canonical_users'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'SEC-A1 preflight: public.% does not exist', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'SEC-A1 preflight: RLS is not enabled on public.%', t;
    END IF;
    -- Realtime delivers rows to client roles through their SELECT privilege.
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = t) THEN
      RAISE EXCEPTION 'SEC-A1 preflight: public.% is in a publication (%); a realtime consumer would lose access',
        t, (SELECT string_agg(pubname, ',') FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = t);
    END IF;
    -- A view over the table would be a second client path to reason about first.
    IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
                WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = ('public.' || t)::regclass
                  AND r.ev_class <> ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'SEC-A1 preflight: a view/rule depends on public.%; review its grants first', t;
    END IF;
  END LOOP;
  -- Remember the policy set so the postcondition can prove it is untouched.
  PERFORM set_config('sec_a1.policy_count',
    (SELECT count(*)::text FROM pg_policy WHERE polrelid IN ('public.canonical_leads'::regclass, 'public.canonical_users'::regclass)),
    true);
END
$preflight$;

REVOKE ALL ON TABLE public.canonical_leads, public.canonical_users FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.canonical_leads, public.canonical_users TO service_role;

DO $verify$
DECLARE
  t text;
  r text;
  rel oid;
BEGIN
  FOREACH t IN ARRAY ARRAY['canonical_leads', 'canonical_users'] LOOP
    rel := ('public.' || t)::regclass;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_table_privilege(r, rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
        RAISE EXCEPTION 'SEC-A1 postcondition: % still holds a table privilege on public.%', r, t;
      END IF;
      IF has_any_column_privilege(r, rel, 'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'SEC-A1 postcondition: % still holds a column privilege on public.%', r, t;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = rel AND a.grantee = 0) THEN
      RAISE EXCEPTION 'SEC-A1 postcondition: PUBLIC still holds a privilege on public.%', t;
    END IF;
    -- has_table_privilege with a list means ANY, so each privilege is checked alone.
    IF NOT has_table_privilege('service_role', rel, 'SELECT')
       OR NOT has_table_privilege('service_role', rel, 'INSERT')
       OR NOT has_table_privilege('service_role', rel, 'UPDATE')
       OR NOT has_table_privilege('service_role', rel, 'DELETE') THEN
      RAISE EXCEPTION 'SEC-A1 postcondition: service_role lacks SELECT/INSERT/UPDATE/DELETE on public.%', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = rel) THEN
      RAISE EXCEPTION 'SEC-A1 postcondition: RLS is no longer enabled on public.%', t;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid IN ('public.canonical_leads'::regclass, 'public.canonical_users'::regclass))::text
     IS DISTINCT FROM current_setting('sec_a1.policy_count', true) THEN
    RAISE EXCEPTION 'SEC-A1 postcondition: the policy set on canonical_leads/canonical_users changed';
  END IF;
  RAISE NOTICE 'SEC-A1: verified — canonical_leads/canonical_users are service_role-only';
END
$verify$;

COMMIT;
