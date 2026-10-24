-- DEFERRED by Closure-015P (owner decision 1). NOT part of the initial migration batch and NOT in the
-- main release commit. This file deliberately has NO timestamp prefix: it is not a migration until it is
-- promoted into supabase/migrations with a version NEWER than every migration applied at that time.
-- Promote and apply ONLY after the application deployment is verified (check C-7) to have eliminated
-- legacy RBAC writes (no rbac_config rows without a save_rbac_config version). Rollback companion:
-- supabase/deferred/rollbacks/rbac_config_contract_legacy_insert_rollback.sql (re-opens the legacy path).
--
-- Rewritten by Closure-015Q (finding F-1, docs/security/CLOSURE_015Q_RBAC_EFFECTIVE_PRIVILEGES.md).
-- It SUPERSEDES the Closure-015N proposal supabase/proposals/closure015n/05_rbac_config_contract_legacy_insert.sql
-- (sha256 b39ffc49…, kept unchanged as the historical review record). That version revoked only
-- INSERT, UPDATE, DELETE; on Supabase it would have left TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on the
-- table and USAGE/SELECT/UPDATE (setval) on its identity sequence, all granted by the hosted default
-- privileges when 20261210000003 created the objects (20261210000003 grants SELECT, INSERT but never
-- revokes the default ALL from service_role, nor touches the sequence).
-- Closure-015R: it runs AFTER 20261211000001_rbac_config_pre_c7_privilege_reduction.sql, which already
-- reduces service_role to SELECT, INSERT and clears the sequence; on that interim state this step's only
-- effective change is removing INSERT. Its own REVOKE ALL / sequence revoke / post-conditions are kept on
-- purpose: they make the final state independent of whatever the pre-state actually is.
-- ════════════════════════════════════════════════════════════════════════════
-- CONTRACT step of the rbac_config expand/contract.
--
-- Verified runtime (Closure-015Q):
--   • reads   — rbacService getRbacConfig / getRbacConfigVersion: PostgREST as service_role, direct
--               SELECT on public.rbac_config (RLS bypassed by service_role).        → needs SELECT.
--   • saves   — rbacService saveRbacConfig: PostgREST /rpc/save_rbac_config as service_role. The function
--               is SECURITY DEFINER (owner postgres, search_path pinned); its INSERT and the identity
--               sequence run as the OWNER.                    → needs EXECUTE only (granted by 0003).
--   • repair / recovery — a super admin saving a valid config through the same route/function (a new
--               head version supersedes an untrusted one).                      → same as saves.
--   • legacy  — the direct .insert() fallback runs only when save_rbac_config is missing (PGRST202); the
--               precondition below guarantees it is present, so nothing legitimate needs direct writes.
--
-- Effect: the application roles keep exactly SELECT (service_role) on the table and NOTHING on its
-- identity sequence; every other direct privilege is removed. The only write path is the governed,
-- version-checked save_rbac_config. Post-conditions verify EFFECTIVE privileges (inheritance, PUBLIC,
-- predefined roles, column grants) and abort the whole step if any non-owner role could still write.
-- RE-RUN: idempotent (REVOKE of a privilege not held is a no-op; GRANT of a held privilege is a no-op).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Preconditions: the governed write path exists and can do the job alone ──
DO $$
DECLARE
  v_fn    regprocedure := to_regprocedure('public.save_rbac_config(jsonb, jsonb, uuid, bigint)');
  v_owner oid;
BEGIN
  IF to_regclass('public.rbac_config') IS NULL THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_PRECONDITION: public.rbac_config does not exist — apply 20261210000003_rbac_config.sql first';
  END IF;
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_PRECONDITION: public.save_rbac_config is missing — apply 20261210000003_rbac_config.sql first';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_PRECONDITION: save_rbac_config must be SECURITY DEFINER (it writes as its owner)';
  END IF;
  SELECT proowner INTO v_owner FROM pg_proc WHERE oid = v_fn;
  IF pg_get_userbyid(v_owner) IN ('service_role', 'authenticated', 'anon', 'authenticator') THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_PRECONDITION: save_rbac_config is owned by application role %', pg_get_userbyid(v_owner);
  END IF;
  IF NOT (has_table_privilege(v_owner, 'public.rbac_config', 'SELECT') AND has_table_privilege(v_owner, 'public.rbac_config', 'INSERT')) THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_PRECONDITION: the owner of save_rbac_config (%) cannot SELECT and INSERT public.rbac_config', pg_get_userbyid(v_owner);
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_PRECONDITION: service_role cannot EXECUTE save_rbac_config — saves would break';
  END IF;
END $$;

-- ── Table: remove every direct privilege of the application roles, then grant back the one read ──
REVOKE ALL ON TABLE public.rbac_config FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT ON TABLE public.rbac_config TO service_role;

-- ── Identity sequence: versions are drawn by the function owner; no application role needs it ──
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, authenticator, service_role',
                 pg_get_serial_sequence('public.rbac_config', 'version'));
END $$;

-- ── Post-conditions on EFFECTIVE privileges (not on the grant statements above) ──
DO $$
DECLARE
  v_tbl      regclass := 'public.rbac_config'::regclass;
  v_seq      text     := pg_get_serial_sequence('public.rbac_config', 'version');
  v_owner    oid      := (SELECT relowner FROM pg_class WHERE oid = 'public.rbac_config'::regclass);
  v_writes   text[]   := ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
  v_bad      text;
BEGIN
  -- 1. service_role: exactly SELECT.
  IF NOT has_table_privilege('service_role', v_tbl, 'SELECT') THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_POSTCONDITION: service_role lost SELECT (reads would break)';
  END IF;
  -- 2. The application roles and PUBLIC: no write privilege; anon/authenticated/authenticator/PUBLIC no read either.
  SELECT string_agg(r || ':' || p, ' ') INTO v_bad
    FROM unnest(ARRAY['service_role', 'authenticated', 'anon', 'authenticator', 'public']) r,
         unnest(v_writes || ARRAY['SELECT']) p
   WHERE has_table_privilege(r, v_tbl, p) AND NOT (r = 'service_role' AND p = 'SELECT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_POSTCONDITION: application roles still hold table privileges: %', v_bad;
  END IF;
  -- 3. No column-level write survives the table-level REVOKE.
  SELECT string_agg(r || ':' || p, ' ') INTO v_bad
    FROM unnest(ARRAY['service_role', 'authenticated', 'anon', 'authenticator', 'public']) r,
         unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES']) p
   WHERE has_any_column_privilege(r, v_tbl, p);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_POSTCONDITION: column-level privileges remain: %', v_bad;
  END IF;
  -- 4. The identity sequence: no application role can draw from or reset it (setval).
  SELECT string_agg(r || ':' || p, ' ') INTO v_bad
    FROM unnest(ARRAY['service_role', 'authenticated', 'anon', 'authenticator', 'public']) r,
         unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
   WHERE has_sequence_privilege(r, v_seq, p);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_POSTCONDITION: sequence privileges remain: %', v_bad;
  END IF;
  -- 5. No OTHER role can write through an inherited / predefined / direct grant. Excluded: superusers and
  --    roles that inherit the table owner (both are owner-level by definition), and the predefined pg_*
  --    roles themselves (their MEMBERS are ordinary roles and are scanned here).
  SELECT string_agg(DISTINCT r.rolname || ':' || p, ' ') INTO v_bad
    FROM pg_roles r, unnest(v_writes) p
   WHERE NOT r.rolsuper
     AND r.rolname NOT LIKE 'pg\_%'
     AND NOT pg_has_role(r.oid, v_owner, 'USAGE')
     AND has_table_privilege(r.oid, v_tbl, p);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_POSTCONDITION: non-owner roles can still write public.rbac_config: %', v_bad;
  END IF;
  SELECT string_agg(DISTINCT r.rolname || ':' || p, ' ') INTO v_bad
    FROM pg_roles r, unnest(ARRAY['USAGE', 'UPDATE']) p
   WHERE NOT r.rolsuper
     AND r.rolname NOT LIKE 'pg\_%'
     AND NOT pg_has_role(r.oid, v_owner, 'USAGE')
     AND has_sequence_privilege(r.oid, v_seq, p);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_POSTCONDITION: non-owner roles can still use or reset %: %', v_seq, v_bad;
  END IF;
  -- 6. The governed path is intact.
  IF NOT has_function_privilege('service_role', 'public.save_rbac_config(jsonb, jsonb, uuid, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_POSTCONDITION: service_role lost EXECUTE on save_rbac_config';
  END IF;
  IF has_function_privilege('authenticated', 'public.save_rbac_config(jsonb, jsonb, uuid, bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.save_rbac_config(jsonb, jsonb, uuid, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_POSTCONDITION: anon/authenticated can EXECUTE save_rbac_config';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_tbl) THEN
    RAISE EXCEPTION 'RBAC_CONTRACT_POSTCONDITION: row level security is not enabled on public.rbac_config';
  END IF;
END $$;

COMMIT;

-- ROLLBACK: supabase/deferred/rollbacks/rbac_config_contract_legacy_insert_rollback.sql
--           (re-grants INSERT only — never the broad hosted default; see its header).
