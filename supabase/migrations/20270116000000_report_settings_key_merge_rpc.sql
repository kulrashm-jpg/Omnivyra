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
--                                   p_if_absent text[], p_merge_nested text[])
--   * replaces ONLY the top-level keys named in p_patch, in one UPDATE statement
--     (report_settings || effective patch): other keys are never read by the client, never rewritten;
--   * p_patch keys must be in the OWNED-key allow-list below (11 system keys + 14 profile keys,
--     e9 2026-11-12 unit 2), else 22023; a patch with ANY unknown key writes nothing;
--   * p_patch must be a non-empty object, else 22023;
--   * p_merge_nested (unit 2): keys merged ONE LEVEL DEEP (stored->k || patch->k), so writers that
--     share a key (market_pulse, default_inputs, company_facts) each change only their own
--     sub-fields. The patched value must be an object; a stored non-object value is refused (22023);
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
--     search_path pinned to pg_catalog, public, pg_temp (pg_temp LAST: unnamed, it is searched FIRST).
--
-- Grants: hosted Supabase gives a new function in public EXECUTE to anon, authenticated and
-- service_role by default privileges, and PostgreSQL gives PUBLIC EXECUTE (proacl IS NULL means
-- OPEN for a function). So: REVOKE ALL from PUBLIC, anon, authenticated; GRANT EXECUTE to
-- service_role, all by full signature. $verify$ proves the end state, by name and by ACL.
--
-- No table, column, policy, trigger or table grant is touched.
-- Re-runnable: CREATE OR REPLACE + REVOKE/GRANT are idempotent; $verify$ re-proves on every replay.
--
-- EARLIER UNRELEASED DRAFTS (never applied to any shared environment by the author): the signature
-- went through three shapes. The preflight REFUSES ("exists with another signature") rather than
-- creating an overload, by design. A sandbox / CI database that applied an earlier draft is remediated
-- by dropping the stale draft, then re-applying this file:
--   DROP FUNCTION IF EXISTS public.merge_report_settings_keys(text, jsonb, timestamptz);
--   DROP FUNCTION IF EXISTS public.merge_report_settings_keys(text, jsonb, timestamptz, text[]);
--   (and the very first local draft, never committed: (uuid, jsonb, timestamptz))
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
                    <> 'p_company_id text, p_patch jsonb, p_updated_at timestamp with time zone, p_if_absent text[], p_merge_nested text[]') THEN
    RAISE EXCEPTION 'RS-MERGE preflight: public.merge_report_settings_keys exists with another signature';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.merge_report_settings_keys(
  p_company_id text,
  p_patch      jsonb,
  p_updated_at timestamptz DEFAULT NULL,
  p_if_absent  text[]      DEFAULT NULL,
  p_merge_nested text[]    DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  -- The OWNED keys: the 11 system keys plus the profile keys (e9 2026-11-12, unit 2). Keep in step
  -- with backend/db/reportSettingsKeys.ts (REPORT_SETTINGS_KEYS); a unit test pins the two lists
  -- equal, and the per-writer ownership map (which writer may touch which key, and how) lives there.
  c_allowed CONSTANT text[] := ARRAY[
    'activation_latch',
    'agent_checkpoints',
    'bootstrap',
    'canonical_understanding',
    'company_facts',
    'competitor_intelligence',
    'default_inputs',
    'discovered_metadata',
    'entity_archetype',
    'industry_review',
    'integrations',
    'intelligence',
    'knowledge_rollbacks',
    'knowledge_snapshots',
    'knowledge_version',
    'last_report_source',
    'last_uploaded_file_name',
    'market_pulse',
    'orchestration_tasks',
    'profile_review',
    'refresh_history',
    'report_input_observation',
    'updated_at',
    'user_guidance',
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
    RAISE EXCEPTION 'merge_report_settings_keys: not an owned report_settings key: %', v_bad
      USING ERRCODE = '22023';
  END IF;
  -- p_if_absent / p_merge_nested: every listed key must be an allow-listed key OF p_patch (a stray
  -- name is a caller bug, refused rather than ignored); NULL elements refused; a key may not be in both.
  IF (p_if_absent IS NOT NULL AND array_position(p_if_absent, NULL) IS NOT NULL)
     OR (p_merge_nested IS NOT NULL AND array_position(p_merge_nested, NULL) IS NOT NULL) THEN
    RAISE EXCEPTION 'merge_report_settings_keys: p_if_absent / p_merge_nested may not contain NULL' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO v_bad
    FROM unnest(COALESCE(p_if_absent, ARRAY[]::text[]) || COALESCE(p_merge_nested, ARRAY[]::text[])) AS k
   WHERE NOT (k = ANY (c_allowed)) OR NOT (p_patch ? k);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'merge_report_settings_keys: p_if_absent / p_merge_nested keys must be allow-listed keys of p_patch: %', v_bad
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_if_absent, ARRAY[]::text[]) && COALESCE(p_merge_nested, ARRAY[]::text[]) THEN
    RAISE EXCEPTION 'merge_report_settings_keys: a key cannot be both p_if_absent and p_merge_nested' USING ERRCODE = '22023';
  END IF;
  -- p_merge_nested: the PATCHED value must be an object (it is merged one level deep).
  SELECT array_agg(k ORDER BY k) INTO v_bad
    FROM unnest(COALESCE(p_merge_nested, ARRAY[]::text[])) AS k
   WHERE jsonb_typeof(p_patch -> k) <> 'object';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'merge_report_settings_keys: p_merge_nested values must be JSON objects: %', v_bad
      USING ERRCODE = '22023';
  END IF;

  -- The effective patch, computed from the STORED row inside the UPDATE (READ COMMITTED re-evaluates
  -- the row it waited on, so a concurrent writer is seen):
  --   * a p_if_absent key the stored row already has is dropped;
  --   * a p_merge_nested key becomes stored->k || patch->k (one level deep: only the patched
  --     sub-fields change). A stored value that is absent or JSON null counts as {}; any other
  --     non-object stored value is REFUSED (the WHERE excludes the row, then 22023 below);
  --   * every other key replaces the stored value wholesale.
  -- CORRECTNESS-CRITICAL: the base MUST be derived from cp ITSELF inside the SET subquery. Do NOT
  -- "tidy" it into a join (FROM public.company_profiles c2 ...). Under READ COMMITTED, an UPDATE whose
  -- target row was changed by a concurrent transaction re-evaluates via EvalPlanQual: it re-fetches the
  -- TARGET row (cp) but does NOT re-execute the rest of the plan, so a joined copy keeps its stale
  -- snapshot, the WHERE re-check passes on the fresh row, and the value is computed from stale data and
  -- COMMITS: the concurrent writer's key is silently lost (no error, no retry). Single-writer tests pass
  -- either way; backend/tests/realschema/report_settings_key_merge.test.ts ("concurrency") is the guard.
  UPDATE public.company_profiles AS cp
     SET report_settings = (
           SELECT x.base || COALESCE((
                    SELECT jsonb_object_agg(
                             e.key,
                             CASE WHEN e.key = ANY (COALESCE(p_merge_nested, ARRAY[]::text[]))
                                  THEN (CASE WHEN jsonb_typeof(x.base -> e.key) = 'object' THEN x.base -> e.key ELSE '{}'::jsonb END) || e.value
                                  ELSE e.value END)
                      FROM jsonb_each(p_patch) AS e
                     WHERE NOT (e.key = ANY (COALESCE(p_if_absent, ARRAY[]::text[])) AND x.base ? e.key)), '{}'::jsonb)
             FROM (SELECT CASE WHEN cp.report_settings IS NULL OR jsonb_typeof(cp.report_settings) = 'null'
                               THEN '{}'::jsonb ELSE cp.report_settings END AS base) AS x),
         updated_at = COALESCE(p_updated_at, cp.updated_at)
   WHERE cp.company_id = p_company_id
     AND (cp.report_settings IS NULL OR jsonb_typeof(cp.report_settings) IN ('object', 'null'))
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p_merge_nested, ARRAY[]::text[])) AS n
                      WHERE jsonb_typeof(cp.report_settings -> n) NOT IN ('object', 'null'));
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    SELECT jsonb_typeof(cp.report_settings) INTO v_kind
      FROM public.company_profiles AS cp
     WHERE cp.company_id = p_company_id;
    IF FOUND AND v_kind IS NOT NULL AND v_kind NOT IN ('object', 'null') THEN
      RAISE EXCEPTION 'merge_report_settings_keys: report_settings of % is a JSON %, not an object; refusing to merge', p_company_id, v_kind
        USING ERRCODE = '22023';
    END IF;
    IF FOUND THEN
      RAISE EXCEPTION 'merge_report_settings_keys: a p_merge_nested key of % holds a non-object; refusing to merge', p_company_id
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN v_n;
END
$fn$;

REVOKE ALL ON FUNCTION public.merge_report_settings_keys(text, jsonb, timestamptz, text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_report_settings_keys(text, jsonb, timestamptz, text[], text[]) TO service_role;

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
   WHERE p.oid = 'public.merge_report_settings_keys(text, jsonb, timestamptz, text[], text[])'::regprocedure;

  IF r.prosecdef THEN
    RAISE EXCEPTION 'RS-MERGE postcondition: must be SECURITY INVOKER';
  END IF;
  IF r.proconfig IS NULL OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY (r.proconfig)) THEN
    RAISE EXCEPTION 'RS-MERGE postcondition: search_path must be pinned to pg_catalog, public, pg_temp; found %', r.proconfig;
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
