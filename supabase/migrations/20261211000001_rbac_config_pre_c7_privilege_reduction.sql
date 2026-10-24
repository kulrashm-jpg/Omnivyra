-- Closure-015R (owner decision 2): rbac_config PRE-C-7 privilege reduction. A forward correction to
-- 20261210000003_rbac_config.sql, which is applied and is NOT modified. Finding F-1 (Closure-015P/015Q):
-- 0003 granted service_role SELECT, INSERT but never revoked the hosted default privileges, so on Supabase
-- service_role holds ALL (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) on the
-- table, and service_role AND authenticated hold USAGE, SELECT, UPDATE (setval) on its identity sequence.
--
-- Interim contract established here (valid until the deferred C-7 contract step):
--   service_role   table: SELECT, INSERT                 sequence: nothing
--   authenticated / anon / authenticator / PUBLIC   table: nothing   sequence: nothing
--   save_rbac_config: unchanged (SECURITY DEFINER, EXECUTE for service_role only)
-- Why exactly these (Closure-015Q, verified on the certification DB and an isolated Supabase copy):
--   • SELECT  — rbacService reads (getRbacConfig, getRbacConfigVersion; the legacy path's newest-row read).
--   • INSERT  — ONLY the legacy direct-insert fallback, used when save_rbac_config is missing (PGRST202).
--               Kept until C-7 proves no deployed instance needs it; then
--               supabase/deferred/rbac_config_contract_legacy_insert.sql removes it.
--   • the identity sequence — not needed: the governed save draws versions as the function OWNER, and a
--               direct INSERT into the identity column needs no sequence privilege.
--   • UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN — no runtime path uses them.
-- Order: 0001 → 0002 → 0003 → 0004 → this migration (independent of the application deploy) → deploy →
-- C-7 → deferred contract step. RE-RUN: idempotent. Transactional; aborts (changes nothing) if an
-- assumption does not hold or an unexpected writer remains afterwards.

BEGIN;

-- ── Preconditions ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn    regprocedure := to_regprocedure('public.save_rbac_config(jsonb, jsonb, uuid, bigint)');
  v_owner oid;
BEGIN
  IF to_regclass('public.rbac_config') IS NULL THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_PRECONDITION: public.rbac_config does not exist — apply 20261210000003_rbac_config.sql first';
  END IF;
  IF pg_get_serial_sequence('public.rbac_config', 'version') IS NULL THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_PRECONDITION: public.rbac_config.version is not an identity column';
  END IF;
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_PRECONDITION: public.save_rbac_config is missing — apply 20261210000003_rbac_config.sql first';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_PRECONDITION: save_rbac_config must be SECURITY DEFINER (it writes as its owner)';
  END IF;
  SELECT proowner INTO v_owner FROM pg_proc WHERE oid = v_fn;
  IF pg_get_userbyid(v_owner) IN ('service_role', 'authenticated', 'anon', 'authenticator') THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_PRECONDITION: save_rbac_config is owned by application role %', pg_get_userbyid(v_owner);
  END IF;
  IF NOT (has_table_privilege(v_owner, 'public.rbac_config', 'SELECT') AND has_table_privilege(v_owner, 'public.rbac_config', 'INSERT')) THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_PRECONDITION: the owner of save_rbac_config (%) cannot SELECT and INSERT public.rbac_config', pg_get_userbyid(v_owner);
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_PRECONDITION: service_role cannot EXECUTE save_rbac_config — saves would break';
  END IF;
END $$;

-- ── Table: drop every direct privilege of the application roles, grant back the interim pair ──
REVOKE ALL ON TABLE public.rbac_config FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT, INSERT ON TABLE public.rbac_config TO service_role;

-- ── Identity sequence: no application role needs it (see header) ──
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, authenticator, service_role',
                 pg_get_serial_sequence('public.rbac_config', 'version'));
END $$;

-- ── Post-conditions on EFFECTIVE privileges ──
DO $$
DECLARE
  v_tbl    regclass := 'public.rbac_config'::regclass;
  v_seq    text     := pg_get_serial_sequence('public.rbac_config', 'version');
  v_owner  oid      := (SELECT relowner FROM pg_class WHERE oid = 'public.rbac_config'::regclass);
  v_all    text[]   := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
  v_bad    text;
BEGIN
  -- 1. service_role holds exactly SELECT and INSERT.
  SELECT string_agg(p || '=' || has_table_privilege('service_role', v_tbl, p)::text, ' ') INTO v_bad
    FROM unnest(v_all) p
   WHERE has_table_privilege('service_role', v_tbl, p) <> (p IN ('SELECT', 'INSERT'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_POSTCONDITION: service_role table privileges are not exactly SELECT, INSERT: %', v_bad;
  END IF;
  -- 2. The other application roles and PUBLIC hold nothing on the table.
  SELECT string_agg(r || ':' || p, ' ') INTO v_bad
    FROM unnest(ARRAY['authenticated', 'anon', 'authenticator', 'public']) r, unnest(v_all) p
   WHERE has_table_privilege(r, v_tbl, p);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_POSTCONDITION: application roles still hold table privileges: %', v_bad;
  END IF;
  -- 3. No column-level UPDATE / REFERENCES survives; column INSERT only where the table grants it.
  SELECT string_agg(r || ':' || p, ' ') INTO v_bad
    FROM unnest(ARRAY['service_role', 'authenticated', 'anon', 'authenticator', 'public']) r,
         unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES']) p
   WHERE has_any_column_privilege(r, v_tbl, p) AND NOT (r = 'service_role' AND p = 'INSERT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_POSTCONDITION: column-level privileges remain: %', v_bad;
  END IF;
  -- 4. The identity sequence: no application role can draw from or reset it.
  SELECT string_agg(r || ':' || p, ' ') INTO v_bad
    FROM unnest(ARRAY['service_role', 'authenticated', 'anon', 'authenticator', 'public']) r,
         unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
   WHERE has_sequence_privilege(r, v_seq, p);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_POSTCONDITION: sequence privileges remain: %', v_bad;
  END IF;
  -- 5. Unexpected (incl. inherited) writers: no non-owner, non-superuser role other than service_role may
  --    write, and service_role may only INSERT. Superusers and roles inheriting the owner are owner-level;
  --    predefined pg_* roles are skipped, their MEMBERS are scanned.
  SELECT string_agg(DISTINCT r.rolname || ':' || p, ' ') INTO v_bad
    FROM pg_roles r, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
   WHERE NOT r.rolsuper
     AND r.rolname NOT LIKE 'pg\_%'
     AND NOT pg_has_role(r.oid, v_owner, 'USAGE')
     AND has_table_privilege(r.oid, v_tbl, p)
     AND NOT (r.rolname = 'service_role' AND p = 'INSERT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_POSTCONDITION: unexpected roles can write public.rbac_config: %', v_bad;
  END IF;
  SELECT string_agg(DISTINCT r.rolname || ':' || p, ' ') INTO v_bad
    FROM pg_roles r, unnest(ARRAY['USAGE', 'UPDATE']) p
   WHERE NOT r.rolsuper
     AND r.rolname NOT LIKE 'pg\_%'
     AND NOT pg_has_role(r.oid, v_owner, 'USAGE')
     AND has_sequence_privilege(r.oid, v_seq, p);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_POSTCONDITION: unexpected roles can use or reset %: %', v_seq, v_bad;
  END IF;
  -- 6. The governed path is intact.
  IF NOT has_function_privilege('service_role', 'public.save_rbac_config(jsonb, jsonb, uuid, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_POSTCONDITION: service_role lost EXECUTE on save_rbac_config';
  END IF;
  IF has_function_privilege('authenticated', 'public.save_rbac_config(jsonb, jsonb, uuid, bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.save_rbac_config(jsonb, jsonb, uuid, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_POSTCONDITION: anon/authenticated can EXECUTE save_rbac_config';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_tbl) THEN
    RAISE EXCEPTION 'RBAC_PRIVILEGE_REDUCTION_POSTCONDITION: row level security is not enabled on public.rbac_config';
  END IF;
END $$;

COMMIT;

-- ROLLBACK: supabase/migrations/rollbacks/rbac_config_pre_c7_privilege_reduction_rollback.sql
--           (re-asserts the interim contract only — never the broad hosted default; see its header).
