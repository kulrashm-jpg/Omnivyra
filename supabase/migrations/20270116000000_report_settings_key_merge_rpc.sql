-- report_settings: a server-side, per-key merge for SYSTEM-owned keys (e9 ruling 2026-11-12,
-- BLOCKING data loss, unit 1). VERSION IS A PLACEHOLDER until 83 assigns one.
--
-- ─── THE DEFECT ───────────────────────────────────────────────────────────
-- company_profiles.report_settings is ONE JSONB column shared by many independent writers
-- (orchestration ledger, agent checkpoints, knowledge versions/snapshots/rollbacks, website
-- fingerprint, activation latch, discovered metadata, canonical understanding, bootstrap marker,
-- plus the user-facing report settings). Each system writer did a CLIENT-SIDE read-modify-write:
--   read report_settings -> { ...read, my_key: v } -> UPDATE report_settings = that object
-- Two ways that loses data:
--   1. a failed read (PostgREST answers {data: null, error}; it never throws) became `{}`, so the
--      write REPLACED the whole column with one key: every other key of the company was wiped;
--   2. two writers of DIFFERENT keys racing: the later whole-column write drops the earlier key.
--
-- ─── WHAT THIS ADDS ───────────────────────────────────────────────────────
-- public.merge_report_settings_keys(p_company_id text, p_patch jsonb, p_updated_at timestamptz,
--                                   p_if_absent text[])
--   * replaces ONLY the top-level keys named in p_patch, in one UPDATE statement
--     (report_settings || p_patch): sibling keys are never read by the client and never rewritten;
--   * p_patch keys must be in the SYSTEM-key allow-list below, else 22023 (the user-facing settings
--     are not writable through here);
--   * p_patch must be a non-empty object, else 22023;
--   * a NULL / JSON-null column counts as `{}`; a column holding any other non-object (array,
--     string, number) is REFUSED with 22023: `||` would otherwise concatenate into an array;
--   * p_updated_at NULL leaves updated_at as it is (several writers never touched it);
--   * p_if_absent (e9 2026-11-12): keys of p_patch written ONLY where the stored column does not
--     already have that key, decided INSIDE the same UPDATE (so on the row version it locks: no
--     read-then-write window). Each must be allow-listed AND be a key of p_patch, else 22023.
--     Used by the bootstrap backfill of discovered_metadata, so incrementalMetadataStore stays the
--     ONLY writer that replaces that key;
--   * returns the number of rows updated: 0 = no company_profiles row (company_id is UNIQUE,
--     idx_company_profiles_company_id), 1 = written. A caller treats 0 as "not written".
--   * SECURITY INVOKER (runs with the caller's own privileges; only service_role is granted),
--     search_path pinned to pg_catalog, public.
--
-- Grants: hosted Supabase gives a new function in public EXECUTE to anon, authenticated and
-- service_role by default privileges, and PostgreSQL gives PUBLIC EXECUTE (proacl IS NULL means
-- OPEN for a function). So: REVOKE ALL from PUBLIC, anon, authenticated; GRANT EXECUTE to
-- service_role, all by full signature. $verify$ proves the end state, by name and by ACL.
--
-- No table, column, policy, trigger or table grant is touched.
-- Re-runnable: CREATE OR REPLACE + REVOKE/GRANT are idempotent; $verify$ re-proves on every replay.
-- Rollback: supabase/migrations/rollbacks/report_settings_key_merge_rpc_rollback.sql

BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = 'public.company_profiles'::regclass
                    AND a.attname = 'report_settings' AND NOT a.attisdropped
                    AND a.atttypid = 'jsonb'::regtype) THEN
    RAISE EXCEPTION 'RS-MERGE preflight: public.company_profiles.report_settings jsonb not found';
  END IF;
  -- company_profiles.company_id is TEXT (baseline), so the parameter is text: a uuid parameter
  -- would fail at call time with 42883 (operator does not exist: text = uuid).
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = 'public.company_profiles'::regclass
                    AND a.attname = 'company_id' AND NOT a.attisdropped
                    AND a.atttypid = 'text'::regtype) THEN
    RAISE EXCEPTION 'RS-MERGE preflight: public.company_profiles.company_id is not text; the signature assumes text';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = 'public.company_profiles'::regclass
                    AND a.attname = 'updated_at' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'RS-MERGE preflight: public.company_profiles.updated_at not found';
  END IF;
  -- One row per company: the function's "0 or 1 rows" contract depends on it.
  IF NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indrelid = 'public.company_profiles'::regclass
                    AND i.indisunique AND i.indnatts = 1
                    AND i.indkey[0] = (SELECT attnum FROM pg_attribute
                                        WHERE attrelid = 'public.company_profiles'::regclass
                                          AND attname = 'company_id')) THEN
    RAISE EXCEPTION 'RS-MERGE preflight: no single-column UNIQUE index on company_profiles.company_id';
  END IF;
  -- A same-named function with ANOTHER signature would survive CREATE OR REPLACE with its own
  -- (possibly open) grants: refuse rather than leave a second entry point.
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname = 'merge_report_settings_keys'
                AND pg_get_function_identity_arguments(p.oid)
                    <> 'p_company_id text, p_patch jsonb, p_updated_at timestamp with time zone, p_if_absent text[]') THEN
    RAISE EXCEPTION 'RS-MERGE preflight: public.merge_report_settings_keys exists with another signature';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.merge_report_settings_keys(
  p_company_id text,
  p_patch      jsonb,
  p_updated_at timestamptz DEFAULT NULL,
  p_if_absent  text[]      DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  -- The SYSTEM-owned keys. Keep in step with backend/db/reportSettingsKeys.ts
  -- (REPORT_SETTINGS_SYSTEM_KEYS); a unit test pins the two lists equal.
  c_allowed CONSTANT text[] := ARRAY[
    'activation_latch',
    'agent_checkpoints',
    'bootstrap',
    'canonical_understanding',
    'discovered_metadata',
    'knowledge_rollbacks',
    'knowledge_snapshots',
    'knowledge_version',
    'orchestration_tasks',
    'refresh_history',
    'website_fingerprint'
  ];
  v_bad  text[];
  v_kind text;
  v_n    integer;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'merge_report_settings_keys: p_company_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'merge_report_settings_keys: p_patch must be a non-empty JSON object' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO v_bad
    FROM jsonb_object_keys(p_patch) AS k
   WHERE NOT (k = ANY (c_allowed));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'merge_report_settings_keys: not a system-owned report_settings key: %', v_bad
      USING ERRCODE = '22023';
  END IF;
  -- p_if_absent: every listed key must be allow-listed AND present in p_patch (a stray name is a
  -- caller bug, refused rather than silently ignored). NULL elements are refused too.
  SELECT array_agg(k ORDER BY k) INTO v_bad
    FROM unnest(COALESCE(p_if_absent, ARRAY[]::text[])) AS k
   WHERE k IS NULL OR NOT (k = ANY (c_allowed)) OR NOT (p_patch ? k);
  IF v_bad IS NOT NULL OR (p_if_absent IS NOT NULL AND array_position(p_if_absent, NULL) IS NOT NULL) THEN
    RAISE EXCEPTION 'merge_report_settings_keys: p_if_absent keys must be allow-listed keys of p_patch: %', v_bad
      USING ERRCODE = '22023';
  END IF;

  -- The effective patch drops each p_if_absent key the STORED row already has. It is computed from
  -- cp.report_settings inside the UPDATE, so a concurrent writer is seen (READ COMMITTED re-evaluates
  -- the row it waited on).
  UPDATE public.company_profiles AS cp
     SET report_settings = CASE
           WHEN cp.report_settings IS NULL OR jsonb_typeof(cp.report_settings) = 'null' THEN p_patch
           ELSE cp.report_settings || (
             SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
               FROM jsonb_each(p_patch) AS e
              WHERE NOT (e.key = ANY (COALESCE(p_if_absent, ARRAY[]::text[])) AND cp.report_settings ? e.key))
         END,
         updated_at = COALESCE(p_updated_at, cp.updated_at)
   WHERE cp.company_id = p_company_id
     AND (cp.report_settings IS NULL OR jsonb_typeof(cp.report_settings) IN ('object', 'null'));
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    SELECT jsonb_typeof(cp.report_settings) INTO v_kind
      FROM public.company_profiles AS cp
     WHERE cp.company_id = p_company_id;
    IF FOUND AND v_kind IS NOT NULL AND v_kind NOT IN ('object', 'null') THEN
      RAISE EXCEPTION 'merge_report_settings_keys: report_settings of % is a JSON %, not an object; refusing to merge', p_company_id, v_kind
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN v_n;
END
$fn$;

REVOKE ALL ON FUNCTION public.merge_report_settings_keys(text, jsonb, timestamptz, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_report_settings_keys(text, jsonb, timestamptz, text[]) TO service_role;

DO $verify$
DECLARE
  r      record;
  v_n    integer;
  v_role text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'merge_report_settings_keys';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'RS-MERGE postcondition: expected exactly one public.merge_report_settings_keys, found %', v_n;
  END IF;

  SELECT p.oid, p.prosecdef, p.proconfig, p.proacl INTO r
    FROM pg_proc p
   WHERE p.oid = 'public.merge_report_settings_keys(text, jsonb, timestamptz, text[])'::regprocedure;

  IF r.prosecdef THEN
    RAISE EXCEPTION 'RS-MERGE postcondition: must be SECURITY INVOKER';
  END IF;
  IF r.proconfig IS NULL OR NOT ('search_path=pg_catalog, public' = ANY (r.proconfig)) THEN
    RAISE EXCEPTION 'RS-MERGE postcondition: search_path must be pinned to pg_catalog, public, found %', r.proconfig;
  END IF;
  -- proacl IS NULL means the DEFAULT ACL, which for a function is EXECUTE to PUBLIC: open.
  IF r.proacl IS NULL THEN
    RAISE EXCEPTION 'RS-MERGE postcondition: proacl is NULL (default ACL = EXECUTE to PUBLIC)';
  END IF;
  IF EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = 0) THEN
    RAISE EXCEPTION 'RS-MERGE postcondition: PUBLIC still holds a privilege';
  END IF;
  -- has_function_privilege folds in PUBLIC and role membership.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role)
       AND has_function_privilege(v_role, r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'RS-MERGE postcondition: % has EXECUTE', v_role;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
     AND NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'RS-MERGE postcondition: service_role lacks EXECUTE';
  END IF;

  RAISE NOTICE 'RS-MERGE: public.merge_report_settings_keys - INVOKER, search_path pinned, EXECUTE service_role only - verified.';
END
$verify$;

COMMIT;
