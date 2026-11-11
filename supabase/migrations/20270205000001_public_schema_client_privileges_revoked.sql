-- ============================================================================
-- SECURITY (#23 Part 3, TARGETED form): revoke client-role privileges on every
-- public TABLE (relkind r, p) that has NO client-admitting policy.
-- Owner decision #23 (2026-11-10). Drafted by Release-controls (virality-83);
-- reviewer virality-05. LOCAL ONLY: NOT APPLIED.
-- ============================================================================
--
-- WHY TARGETED, NOT SCHEMA-WIDE (Part 2 result, owner #22, closure-r22)
--   262 policies in public apply to PUBLIC/anon/authenticated. 163 are pure
--   service-role checks (exactly `auth.role() = 'service_role'`, USING and/or
--   WITH CHECK). The other 99, on 53 tables, admit clients (public blog,
--   per-user, tenant-scoped `current_company_id()`). On those 53 the client
--   grants are LOAD-BEARING, so a schema-wide revoke would break them. They
--   are excluded and left completely untouched.
--
-- WHY THE REST IS PROVABLY SAFE
--   Every other public table has RLS enabled (sweep s01: 0 without RLS) and no
--   policy that admits a client, so RLS already denies anon/authenticated every
--   row; their table grants carry no working path. They do carry REFERENCES,
--   TRIGGER and MAINTAIN, which RLS does not govern.
--
-- DRIFT GUARD
--   The exclusion set is COMPUTED here with the same rule Part 2 used, and must
--   EQUAL the measured list below (restricted to relations that exist). Any
--   difference RAISEs: a new client-admitting policy, or one removed, is a
--   decision for a person, not something this migration silently absorbs.
--
-- WHAT THIS DOES, in one transaction
--   1. Snapshots every table- and column-level privilege held by anon,
--      authenticated or PUBLIC on each target relation into
--      public.client_privilege_revoke_snapshot (exact rollback).
--   2. REVOKE ALL ... FROM PUBLIC, anon, authenticated on each target table.
--      (A table-level REVOKE also revokes the matching column privileges; the
--      postcondition still measures columns.)
--   3. POSTCONDITION: on every target relation, for anon and authenticated,
--      has_table_privilege over all 8 privileges and has_any_column_privilege
--      over SELECT/INSERT/UPDATE/REFERENCES are false; and no excluded relation's
--      ACL changed. Any failure RAISEs and the transaction rolls back.
--
-- VIEWS, MATERIALIZED VIEWS AND FOREIGN TABLES ARE OUT OF SCOPE (virality-05 review).
--   They have no policies, so the exclusion rule cannot measure them; revoking
--   them here would rest on an assumption, not evidence. Owner-rights views
--   granted to anon are RLS bypasses (high value), and for a view the grant is
--   the only control (high risk). Separate change, after measuring client grants
--   and security_invoker per view and sweeping code for .from(<view>).
--
-- NOT touched: the 53 client-admitting tables, service_role, postgres, RLS
-- settings, policies, sequences, functions, other schemas.
-- Rollback: rollbacks/public_schema_client_privileges_revoked_rollback.sql

BEGIN;

-- pg_get_expr schema-qualifies auth.role() only when auth is NOT on the search_path.
-- Pin it so the policy text deparses exactly as it did when measured (p2b).
SET LOCAL search_path = public, pg_catalog;

CREATE TABLE IF NOT EXISTS public.client_privilege_revoke_snapshot (
  migration_version text        NOT NULL,
  relname           text        NOT NULL,
  relkind           text        NOT NULL,
  attname           text        NOT NULL DEFAULT '',
  grantee           text        NOT NULL,
  privilege_type    text        NOT NULL,
  is_grantable      boolean     NOT NULL,
  captured_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (migration_version, relname, attname, grantee, privilege_type)
);
COMMENT ON TABLE public.client_privilege_revoke_snapshot IS
  'Pre-change client-role (anon, authenticated, PUBLIC) privileges captured by the targeted client revoke '
  '(#23 Part 3), so its rollback restores the exact prior ACL. Service role only.';
ALTER TABLE public.client_privilege_revoke_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.client_privilege_revoke_snapshot FROM PUBLIC, anon, authenticated;

-- The exclusion rule, shared by the work and the postcondition.
CREATE TEMP TABLE _client_admitting ON COMMIT DROP AS
SELECT DISTINCT c.relname
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND (0 = ANY (pol.polroles)
     OR to_regrole('anon')::oid = ANY (pol.polroles)
     OR to_regrole('authenticated')::oid = ANY (pol.polroles))
   AND NOT (
         coalesce(pg_get_expr(pol.polqual, pol.polrelid), '(auth.role() = ''service_role''::text)')
           = '(auth.role() = ''service_role''::text)'
     AND coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '(auth.role() = ''service_role''::text)')
           = '(auth.role() = ''service_role''::text)'
     AND (pol.polqual IS NOT NULL OR pol.polwithcheck IS NOT NULL));

CREATE TEMP TABLE _excluded_acl_before ON COMMIT DROP AS
SELECT c.relname, coalesce(c.relacl::text, '') AS acl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname IN (SELECT relname FROM _client_admitting);

DO $$
DECLARE
  v_version constant text := '20270205000001';
  -- Measured 2026-11-10 (closure-r22, p2b): the 53 tables with a client-admitting policy.
  expected constant text[] := ARRAY[
    'access_requests','action_registry','blog_comments','blog_relationships','blog_series','blog_series_posts',
    'brand_memory','campaigns','canonical_domains','canonical_leads','canonical_media_assets','canonical_page_views',
    'canonical_pages','canonical_revenue_events','canonical_sessions','canonical_users','company_topic_coverage',
    'composition_asset_references','content','content_approval_history','content_asset','content_block',
    'content_memory','content_originality','content_performance','content_prediction','content_quality',
    'content_recommendation','content_revision','content_type','content_variant','creator_asset_attachments',
    'creator_assets','creator_composition_briefs','data_source_status','decision_events','decision_objects',
    'extension_commands','extension_events','extension_sessions','feature_completion','free_credit_claims',
    'free_credit_events','free_credit_profiles','free_credit_unlocks','learning_intelligence','learning_memory',
    'notifications','public_blogs','publication_lineage','reports','user_override','user_preferences'];
  expected_present text[];
  computed text[];
  rec record;
BEGIN
  -- DRIFT GUARD: computed exclusion set must equal the measured list (for relations that exist).
  SELECT coalesce(array_agg(e ORDER BY e), ARRAY[]::text[]) INTO expected_present
    FROM unnest(expected) e
   WHERE to_regclass(format('public.%I', e)) IS NOT NULL;
  SELECT coalesce(array_agg(relname ORDER BY relname), ARRAY[]::text[]) INTO computed FROM _client_admitting;
  IF computed IS DISTINCT FROM expected_present THEN
    -- Diagnosis first: if service_role-mentioning policies stopped matching the literal,
    -- this is a deparse/search_path difference, not a policy change.
    IF EXISTS (
      SELECT 1 FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND (0 = ANY (pol.polroles)
           OR to_regrole('anon')::oid = ANY (pol.polroles)
           OR to_regrole('authenticated')::oid = ANY (pol.polroles))
         AND (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) LIKE '%service_role%'
         AND NOT (
               coalesce(pg_get_expr(pol.polqual, pol.polrelid), '(auth.role() = ''service_role''::text)')
                 = '(auth.role() = ''service_role''::text)'
           AND coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '(auth.role() = ''service_role''::text)')
                 = '(auth.role() = ''service_role''::text)'
           AND (pol.polqual IS NOT NULL OR pol.polwithcheck IS NOT NULL))) THEN
      RAISE EXCEPTION 'client revoke drift guard: DEPARSE MISMATCH suspected: policies mentioning service_role no longer match the measured literal (auth.role() = ''service_role''::text). Re-measure (p2b) under the apply role; do not edit the literal.';
    END IF;
    RAISE EXCEPTION 'client revoke drift guard: client-admitting tables differ from the measured list. only computed: %; only measured: %',
      (SELECT coalesce(array_agg(x), ARRAY[]::text[]) FROM unnest(computed) x WHERE x <> ALL (expected_present)),
      (SELECT coalesce(array_agg(x), ARRAY[]::text[]) FROM unnest(expected_present) x WHERE x <> ALL (computed));
  END IF;

  -- 1. SNAPSHOT (table level, then column level) for every target relation. Grantee 0 = PUBLIC.
  INSERT INTO public.client_privilege_revoke_snapshot
         (migration_version, relname, relkind, attname, grantee, privilege_type, is_grantable)
  SELECT v_version, c.relname, c.relkind::text, '',
         CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END,
         x.privilege_type, x.is_grantable
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) x
    LEFT JOIN pg_roles g ON g.oid = x.grantee
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND c.relname <> 'client_privilege_revoke_snapshot'
     AND c.relname NOT IN (SELECT relname FROM _client_admitting)
     AND (x.grantee = 0 OR g.rolname IN ('anon', 'authenticated'))
  ON CONFLICT DO NOTHING;

  INSERT INTO public.client_privilege_revoke_snapshot
         (migration_version, relname, relkind, attname, grantee, privilege_type, is_grantable)
  SELECT v_version, c.relname, c.relkind::text, a.attname,
         CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END,
         x.privilege_type, x.is_grantable
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
    CROSS JOIN LATERAL aclexplode(a.attacl) x
    LEFT JOIN pg_roles g ON g.oid = x.grantee
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND c.relname NOT IN (SELECT relname FROM _client_admitting)
     AND (x.grantee = 0 OR g.rolname IN ('anon', 'authenticated'))
  ON CONFLICT DO NOTHING;

  -- 2. REVOKE on every target relation that holds anything (table or column level).
  FOR rec IN
    SELECT DISTINCT s.relname
      FROM public.client_privilege_revoke_snapshot s
     WHERE s.migration_version = v_version
       AND to_regclass(format('public.%I', s.relname)) IS NOT NULL
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', rec.relname);
  END LOOP;
END
$$;

-- 3. POSTCONDITION.
DO $$
DECLARE
  privs    text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  colprivs constant text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'];
  held text[] := ARRAY[]::text[];
  t record;
  r text;
  p text;
  n_checked int := 0;
  n_changed int;
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    privs := array_append(privs, 'MAINTAIN');
  END IF;
  FOR t IN
    SELECT c.oid, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND c.relname NOT IN (SELECT relname FROM _client_admitting)
  LOOP
    n_checked := n_checked + 1;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        CONTINUE;
      END IF;
      FOREACH p IN ARRAY privs LOOP
        IF has_table_privilege(r, t.oid, p) THEN
          held := held || format('%s %s %s', r, p, t.relname);
        END IF;
      END LOOP;
      FOREACH p IN ARRAY colprivs LOOP
        IF has_any_column_privilege(r, t.oid, p) THEN
          held := held || format('%s %s (column) %s', r, p, t.relname);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  SELECT count(*) INTO n_changed
    FROM _excluded_acl_before b
    JOIN pg_class c ON c.relname = b.relname
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
   WHERE coalesce(c.relacl::text, '') <> b.acl;
  IF n_changed > 0 THEN
    held := held || format('%s excluded (client-admitting) relation(s) had their ACL changed', n_changed);
  END IF;
  IF array_length(held, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'targeted client privileges postcondition (% relations checked): % violation(s), first: %',
      n_checked, array_length(held, 1), array_to_string(held[1:30], '; ');
  END IF;
END
$$;

COMMIT;
