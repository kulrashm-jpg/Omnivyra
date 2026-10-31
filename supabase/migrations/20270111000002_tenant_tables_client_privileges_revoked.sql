-- ============================================================================
-- SECURITY — tenant / identity / public-content tables: revoke client-role
-- privileges the application does not use
-- STEP SEC-A (class-wide, Workstream A) · prepared 2026-10-31 · NOT YET APPLIED
-- ============================================================================
--
-- SCOPE: exactly 50 tables, listed below by class. Nothing else is touched.
-- Separate from SEC-A1 (20270111000000, canonical_leads / canonical_users),
-- which this migration neither repeats nor depends on.
--
-- PRODUCTION STATE (read-only evidence captured 2026-10-31T04:08Z)
--   All 50 tables: RLS ENABLED; owner postgres; postgres=arwdDxtm and
--   service_role=arwdDxtm; no column ACLs; in no publication. Client grants:
--     anon=arwdxtm, authenticated=arwdxtm ....... 33 tables
--     authenticated=arwdxtm only ................  5 tables
--     anon=rm, authenticated=rm .................  4 tables (public blog/taxonomy reads)
--     none ......................................  8 tables (already closed)
--   Their client-applicable policies are all `TO public`:
--     claim:company_id  company_id = current_company_id()   (TOP-LEVEL JWT claim)
--     claim:org_id      org_id = (auth.jwt()->>'org_id')::uuid [AND user_id = auth.uid()]
--     membership(uid)   company_id IN (SELECT company_id FROM user_company_roles
--                         WHERE user_id = auth.uid() AND status = 'active')  (ALL cmd)
--     own-row(uid)      user_id = auth.uid()
--     public read       USING (true) / status = 'published' / status = 'approved'
--   companies, users, user_company_roles carry only a TO service_role policy.
--
-- WHY (see TENANT_ISOLATION_AND_GRANT_INVENTORY for the per-table record)
--   * No token a client can hold today carries a top-level company_id or org_id
--     (Supabase Auth does not emit them, no access-token hook exists in the
--     database, nothing in this repository mints Supabase JWTs; user_metadata
--     is user-writable but nested and ignored by every policy). The claim
--     tables are therefore closed only by the ABSENCE of a claim — any future
--     hook that emits one would hand every member direct PostgREST
--     read/insert/update/delete on their tenant's rows, bypassing server RBAC,
--     validation and provenance, plus an upsert existence oracle across tenants.
--   * The membership tables are inert today ONLY because user_company_roles has
--     no client-readable policy, so the subquery returns nothing. One routine
--     "users can read their own memberships" policy would turn ALL 20 of them
--     into direct member read/WRITE paths (their policies are FOR ALL).
--   * The own-row tables expose free-credit / phone / access-request / override
--     rows and an UPDATE path (free_credit_profiles, notifications,
--     user_preferences) to any session — but the application never uses it.
--     CONFIRMED (A-C2): fcp_update_own has no WITH CHECK beyond user_id, so any
--     signed-up user can PATCH their own free_credit_profiles row to another
--     tenant's organization_id with a past credit_expiry_at and a large
--     initial_credits; the daily credit-expiry job trusts those columns and
--     would expire that tenant's free balance. Closed here (no client UPDATE).
--   * blog_comments (A-C1): the "approved" policy hands author_email (PII) to
--     anyone with the publishable key; the app inserts every comment as
--     'approved'. CONFIRMED exposure whenever comments exist.
--   * Public content tables carry write grants (and MAINTAIN) nobody needs.
--
-- WHY THIS CANNOT BREAK THE APPLICATION (audited on main b20278de)
--   * The browser client (lib/supabaseBrowser.ts — the ONLY publishable-key
--     client in the repository) is used for Auth and one realtime channel on
--     credit_transactions (not touched here). It performs no .from()/.rpc().
--   * Every reader/writer of every listed table goes through the service-role
--     client (backend/db/supabaseClient.ts and the SUPABASE_SECRET_KEY clients
--     in backend/services/featureCompletion*.ts). service_role has BYPASSRLS
--     and its privileges are NOT touched (asserted unchanged below).
--   * Extension tokens are server-issued HMAC tokens checked by
--     backend/middleware/extensionAuthMiddleware.ts; the extension never talks
--     to PostgREST.
--   * Triggers on these tables, and invoker functions/views that read them,
--     run with the caller's privileges; the only callers are service_role.
--     FK and ON DELETE actions run as the table owner.
--   * Kept: SELECT on public_blogs (status='published'), blog_series,
--     blog_series_posts, blog_relationships, content_type — intentional public
--     reads. Nothing in the app needs them via PostgREST either, but they are
--     designed to be public and hold no tenant data.
--
-- WHAT THIS DOES
--   1. REVOKE ALL FROM PUBLIC, anon, authenticated on 45 tables.
--   2. REVOKE every privilege except SELECT from PUBLIC, anon, authenticated on
--      the 5 public-read tables (INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
--      TRIGGER/MAINTAIN), keeping SELECT for anon and authenticated.
--   Policies are NOT dropped or altered; without a privilege they are moot for
--   client roles. service_role and postgres ACL entries are not touched.
--   Not in scope (separate, owned proposals): the ~800 tables whose only
--   client-applicable policies are service-role claim gates or that have no
--   policy; content_performance / content_prediction / learning_intelligence /
--   learning_memory (membership tables present in production but absent from
--   the repository schema — schema drift, cannot be replay-tested).
--
-- REPLAY SAFETY
--   Idempotent. The preflight asserts structure only (existence, RLS, no
--   publication, no client-granted definer view), never the pre-change ACL, so
--   it passes on the ACL-free CI baseline, on production and on a second run.
--
-- APPLY  (after explicit authorization only)
--   *** DO NOT RUN `supabase db push`. *** psql -v ON_ERROR_STOP=1 -f <this file>
--   per docs/migration-discipline.md. Own transaction; any failed assertion
--   rolls everything back. Catalog-only change (brief lock per table).
-- ROLLBACK
--   supabase/migrations/rollbacks/tenant_tables_client_privileges_revoked_rollback.sql
--   restores production's pre-change client ACL exactly (re-opens the exposure).
-- ============================================================================

BEGIN;

DO $preflight$
DECLARE
  t text;
  rel regclass;
  bad text;
  revoke_all text[] := ARRAY[
    -- claim:company_id (current_company_id())
    'action_registry', 'campaigns', 'canonical_domains', 'canonical_page_views', 'canonical_pages',
    'canonical_revenue_events', 'canonical_sessions', 'data_source_status', 'decision_events', 'decision_objects',
    -- claim:org_id (auth.jwt()->>'org_id')
    'extension_commands', 'extension_events', 'extension_sessions',
    -- membership(uid) via user_company_roles
    'brand_memory', 'canonical_media_assets', 'company_topic_coverage', 'composition_asset_references', 'content',
    'content_approval_history', 'content_asset', 'content_block', 'content_memory', 'content_originality',
    'content_quality', 'content_recommendation', 'content_revision', 'content_variant', 'creator_asset_attachments',
    'creator_assets', 'creator_composition_briefs', 'feature_completion', 'publication_lineage', 'reports',
    -- own-row(uid)
    'access_requests', 'free_credit_claims', 'free_credit_events', 'free_credit_profiles', 'free_credit_unlocks',
    'notifications', 'user_override', 'user_preferences',
    -- identity core (service_role-only policies)
    'companies', 'users', 'user_company_roles',
    -- public read that exposes author_email
    'blog_comments'];
  select_only text[] := ARRAY['public_blogs', 'blog_relationships', 'blog_series', 'blog_series_posts', 'content_type'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'SEC-A preflight: role service_role missing or not BYPASSRLS; refusing to remove client access';
  END IF;
  IF cardinality(revoke_all) <> 45 OR cardinality(select_only) <> 5 THEN
    RAISE EXCEPTION 'SEC-A preflight: table lists changed (% + %), expected 45 + 5', cardinality(revoke_all), cardinality(select_only);
  END IF;
  FOREACH t IN ARRAY revoke_all || select_only LOOP
    rel := to_regclass('public.' || quote_ident(t));
    IF rel IS NULL THEN
      RAISE EXCEPTION 'SEC-A preflight: public.% does not exist', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = rel) THEN
      RAISE EXCEPTION 'SEC-A preflight: RLS is not enabled on public.%', t;
    END IF;
    -- Realtime delivers rows to client roles through their SELECT privilege.
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = t) THEN
      RAISE EXCEPTION 'SEC-A preflight: public.% is in a publication (%); a realtime consumer would lose access',
        t, (SELECT string_agg(pubname, ',') FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = t);
    END IF;
  END LOOP;
  -- A view that runs with its OWNER's rights (not security_invoker) and is
  -- client-readable would stay a client path after the base-table revoke.
  SELECT string_agg(DISTINCT v.relname || '->' || b.relname, ', ') INTO bad
    FROM pg_class b
    JOIN pg_depend d ON d.refobjid = b.oid AND d.classid = 'pg_rewrite'::regclass
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class v ON v.oid = r.ev_class AND v.oid <> b.oid
   WHERE b.relnamespace = 'public'::regnamespace AND b.relname = ANY (revoke_all)
     AND NOT coalesce(v.relkind = 'v' AND v.reloptions::text[] && ARRAY['security_invoker=true', 'security_invoker=on'], false)
     AND (has_table_privilege('anon', v.oid, 'SELECT') OR has_table_privilege('authenticated', v.oid, 'SELECT'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'SEC-A preflight: owner-rights views readable by clients depend on revoked tables: %', bad;
  END IF;

  -- Snapshots for the postcondition: policy set, RLS flags, and every
  -- non-client ACL entry (service_role, postgres, ...) must be unchanged.
  CREATE TEMP TABLE sec_a_pre ON COMMIT DROP AS
    SELECT c.relname,
           c.relrowsecurity, c.relforcerowsecurity,
           (SELECT coalesce(string_agg(p.polname || ':' || p.polcmd::text || ':' || p.polpermissive::text || ':' || p.polroles::text || ':'
                    || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
                    '|' ORDER BY p.polname), '')
              FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
           (SELECT coalesce(string_agg(a.grantee::regrole::text || '=' || a.privilege_type, ',' ORDER BY a.grantee::regrole::text, a.privilege_type), '')
              FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
             WHERE a.grantee <> 0 AND a.grantee::regrole::text NOT IN ('anon', 'authenticated')) AS other_acl
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY (revoke_all || select_only);
  PERFORM set_config('sec_a.revoke_all', array_to_string(revoke_all, ','), true);
  PERFORM set_config('sec_a.select_only', array_to_string(select_only, ','), true);
END
$preflight$;

-- 1. No client privilege at all (45 tables).
REVOKE ALL ON TABLE
  public.action_registry, public.campaigns, public.canonical_domains, public.canonical_page_views,
  public.canonical_pages, public.canonical_revenue_events, public.canonical_sessions,
  public.data_source_status, public.decision_events, public.decision_objects,
  public.extension_commands, public.extension_events, public.extension_sessions,
  public.brand_memory, public.canonical_media_assets, public.company_topic_coverage,
  public.composition_asset_references, public.content, public.content_approval_history,
  public.content_asset, public.content_block, public.content_memory, public.content_originality,
  public.content_quality, public.content_recommendation, public.content_revision,
  public.content_variant, public.creator_asset_attachments, public.creator_assets,
  public.creator_composition_briefs, public.feature_completion, public.publication_lineage,
  public.reports,
  public.access_requests, public.free_credit_claims, public.free_credit_events,
  public.free_credit_profiles, public.free_credit_unlocks, public.notifications,
  public.user_override, public.user_preferences,
  public.companies, public.users, public.user_company_roles,
  public.blog_comments
  FROM PUBLIC, anon, authenticated;

-- 2. Public content: keep SELECT only (5 tables).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.public_blogs, public.blog_relationships, public.blog_series, public.blog_series_posts,
  public.content_type
  FROM PUBLIC, anon, authenticated;
-- This migration adds no privilege for any role.

DO $verify$
DECLARE
  t text;
  r text;
  rel oid;
  revoke_all text[] := string_to_array(current_setting('sec_a.revoke_all'), ',');
  select_only text[] := string_to_array(current_setting('sec_a.select_only'), ',');
  changed text;
BEGIN
  FOREACH t IN ARRAY revoke_all || select_only LOOP
    rel := ('public.' || quote_ident(t))::regclass;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_table_privilege(r, rel, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
        RAISE EXCEPTION 'SEC-A postcondition: % still holds a write/maintenance privilege on public.%', r, t;
      END IF;
      IF has_any_column_privilege(r, rel, 'INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'SEC-A postcondition: % still holds a column write privilege on public.%', r, t;
      END IF;
      IF t = ANY (revoke_all) AND (has_table_privilege(r, rel, 'SELECT') OR has_any_column_privilege(r, rel, 'SELECT')) THEN
        RAISE EXCEPTION 'SEC-A postcondition: % can still read public.%', r, t;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = rel AND a.grantee = 0) THEN
      RAISE EXCEPTION 'SEC-A postcondition: PUBLIC still holds a privilege on public.%', t;
    END IF;
  END LOOP;

  SELECT string_agg(s.relname, ', ') INTO changed
    FROM sec_a_pre s JOIN pg_class c ON c.relname = s.relname AND c.relnamespace = 'public'::regnamespace
   WHERE s.relrowsecurity IS DISTINCT FROM c.relrowsecurity
      OR s.relforcerowsecurity IS DISTINCT FROM c.relforcerowsecurity
      OR s.policies IS DISTINCT FROM
         (SELECT coalesce(string_agg(p.polname || ':' || p.polcmd::text || ':' || p.polpermissive::text || ':' || p.polroles::text || ':'
                  || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
                  '|' ORDER BY p.polname), '')
            FROM pg_policy p WHERE p.polrelid = c.oid)
      OR s.other_acl IS DISTINCT FROM
         (SELECT coalesce(string_agg(a.grantee::regrole::text || '=' || a.privilege_type, ',' ORDER BY a.grantee::regrole::text, a.privilege_type), '')
            FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
           WHERE a.grantee <> 0 AND a.grantee::regrole::text NOT IN ('anon', 'authenticated'));
  IF changed IS NOT NULL THEN
    RAISE EXCEPTION 'SEC-A postcondition: RLS flags, policies or non-client ACL entries changed on: %', changed;
  END IF;
  IF (SELECT count(*) FROM sec_a_pre) <> 50 THEN
    RAISE EXCEPTION 'SEC-A postcondition: expected 50 snapshotted tables, found %', (SELECT count(*) FROM sec_a_pre);
  END IF;
  RAISE NOTICE 'SEC-A: verified — 45 tables service-only for clients, 5 public tables SELECT-only; policies, RLS and service_role/postgres ACL unchanged';
END
$verify$;

DROP TABLE IF EXISTS sec_a_pre;

COMMIT;
