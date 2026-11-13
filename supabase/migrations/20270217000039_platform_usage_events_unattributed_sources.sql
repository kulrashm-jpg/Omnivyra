-- 20270217000039 - platform_usage_events takes ALL platform spend: cache / external_api sources, unattributed rows
-- (6f; version from 83; e9 re-plan of the dropped 038; e1 rulings as ledger owner).
--
-- WHERE THIS CONCERN ALREADY LIVES (e9 standing question). Platform spend - provider cost that belongs to no
--   customer - already has ONE structural home: public.platform_usage_events (B7.8-C, 20260930120000, released). Its
--   only writer today is the embedding path. The rest of platform spend (AI-gateway calls with no company,
--   AI-visibility probes, external-API calls with no company) is still written into usage_events under the all-zero
--   sentinel organization (688 rows in prod, 83 C55) - a fake tenant. This migration EXTENDS the existing home so
--   those writers can move there; it does not build a second store.
--
-- WHAT. Schema only - NO data write (the 688 rows move in a separate, owner-approved, count-guarded D-step).
--   1. source_type CHECK gains 'cache' and 'external_api' (the gateway's cache-hit rows and external-API calls).
--   2. resource_id becomes NULLABLE, but ONLY for resource_type = 'unattributed' - TWO-WAY (e1):
--        (resource_type = 'unattributed') = (resource_id IS NULL)
--      an 'unattributed' row has no resource id, and every other row still must have one. resource_type stays
--      NOT NULL, so the comparison is never NULL (a CHECK passes on NULL - no hole).
--   3. model_name becomes NULLABLE ONLY for source_type = 'external_api' (e1 option (a): external-API calls have no
--      model; no fake model value):  model_name IS NOT NULL OR source_type = 'external_api'.
--   4. total_cost, when present, must be a finite, non-negative amount (e1): NULL (pricing unresolved - the
--      embedding path's documented case) OR (>= 0 AND not NaN AND below +Infinity). numeric accepts 'NaN' and,
--      from PG 14, 'Infinity'; NaN sorts ABOVE every number, so ">= 0" alone would let it through.
--   Existing rows are VALIDATED against the new checks (the table is small; the preflight names any violator first).
--   Privilege posture RESTATED (enumerative-hardening lesson, e1): RLS stays enabled with zero policies; anon /
--   authenticated hold nothing; service_role SELECT, INSERT (its writer's only operations). Hosted Supabase gives
--   service_role ALL, so the GRANT is a no-op there; the postcondition asserts only what must hold everywhere.
--
-- ROLLBACK: rollbacks/platform_usage_events_unattributed_sources_rollback.sql - restores the original CHECK and NOT
--   NULLs; it REFUSES while any row uses what this migration allowed (cache / external_api source, NULL resource_id,
--   NULL model_name), since dropping them would lose financial records.

-- Preflight 1: the table and the constraint this migration replaces are exactly as 20260930120000 created them.
DO $preflight_shape$
DECLARE
  v_def text;
BEGIN
  IF to_regclass('public.platform_usage_events') IS NULL THEN
    RAISE EXCEPTION '039 preflight: public.platform_usage_events does not exist (20260930120000 not applied)';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.platform_usage_events'::regclass AND c.conname = 'platform_usage_events_source_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '039 preflight: platform_usage_events_source_type_check not found - refusing to guess which CHECK to replace';
  END IF;
  -- Already widened by a previous run of this migration: accept exactly that; refuse any other definition.
  IF v_def NOT IN (
    'CHECK ((source_type = ANY (ARRAY[''system''::text, ''embedding''::text, ''llm''::text, ''internal''::text])))',
    'CHECK ((source_type = ANY (ARRAY[''system''::text, ''embedding''::text, ''llm''::text, ''internal''::text, ''cache''::text, ''external_api''::text])))'
  ) THEN
    RAISE EXCEPTION '039 preflight: platform_usage_events_source_type_check has an unexpected definition: %', v_def;
  END IF;
END
$preflight_shape$;

-- Preflight 2: existing rows must satisfy the new checks - name any violator instead of failing mid-way.
DO $preflight_rows$
DECLARE
  v_cost int;
BEGIN
  SELECT count(*) INTO v_cost FROM public.platform_usage_events
   WHERE total_cost IS NOT NULL AND NOT (total_cost >= 0 AND total_cost <> 'NaN'::numeric AND total_cost < 'Infinity'::numeric);
  IF v_cost > 0 THEN
    RAISE EXCEPTION '039 preflight: % platform_usage_events row(s) have a negative / NaN / infinite total_cost - resolve first (owner-approved D-step)', v_cost;
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_usage_events WHERE resource_type = 'unattributed') THEN
    RAISE EXCEPTION '039 preflight: rows with resource_type = ''unattributed'' already exist (they carry a resource_id) - refusing to reinterpret them';
  END IF;
END
$preflight_rows$;

-- 1. source_type: + cache, external_api (replace the named CHECK).
ALTER TABLE public.platform_usage_events DROP CONSTRAINT IF EXISTS platform_usage_events_source_type_check;
ALTER TABLE public.platform_usage_events ADD CONSTRAINT platform_usage_events_source_type_check
  CHECK (source_type IN ('system', 'embedding', 'llm', 'internal', 'cache', 'external_api'));

-- 2. resource_id: NULL exactly when the row is 'unattributed'.
ALTER TABLE public.platform_usage_events ALTER COLUMN resource_id DROP NOT NULL;
DO $resource_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.platform_usage_events'::regclass AND conname = 'platform_usage_events_unattributed_resource_check') THEN
    ALTER TABLE public.platform_usage_events ADD CONSTRAINT platform_usage_events_unattributed_resource_check
      CHECK ((resource_type = 'unattributed') = (resource_id IS NULL));
  END IF;
END
$resource_check$;

-- 3. model_name: NULL only for external_api.
ALTER TABLE public.platform_usage_events ALTER COLUMN model_name DROP NOT NULL;
DO $model_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.platform_usage_events'::regclass AND conname = 'platform_usage_events_model_name_check') THEN
    ALTER TABLE public.platform_usage_events ADD CONSTRAINT platform_usage_events_model_name_check
      CHECK (model_name IS NOT NULL OR source_type = 'external_api');
  END IF;
END
$model_check$;

-- 4. total_cost: NULL or a finite, non-negative amount.
DO $cost_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.platform_usage_events'::regclass AND conname = 'platform_usage_events_total_cost_check') THEN
    ALTER TABLE public.platform_usage_events ADD CONSTRAINT platform_usage_events_total_cost_check
      CHECK (total_cost IS NULL OR (total_cost >= 0 AND total_cost <> 'NaN'::numeric AND total_cost < 'Infinity'::numeric));
  END IF;
END
$cost_check$;

-- Privilege posture, restated.
ALTER TABLE public.platform_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_usage_events FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.platform_usage_events TO service_role;

-- Postcondition: exactly what this migration promises, measured.
DO $verify$
DECLARE
  v_src text;
  v_res text;
  v_model text;
  v_cost text;
  r text;
  p text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_src FROM pg_constraint WHERE conrelid = 'public.platform_usage_events'::regclass AND conname = 'platform_usage_events_source_type_check' AND convalidated;
  IF v_src IS DISTINCT FROM 'CHECK ((source_type = ANY (ARRAY[''system''::text, ''embedding''::text, ''llm''::text, ''internal''::text, ''cache''::text, ''external_api''::text])))' THEN
    RAISE EXCEPTION '039 postcondition: source_type CHECK missing, unvalidated or different: %', coalesce(v_src, '<none>');
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_res FROM pg_constraint WHERE conrelid = 'public.platform_usage_events'::regclass AND conname = 'platform_usage_events_unattributed_resource_check' AND convalidated;
  IF v_res IS DISTINCT FROM 'CHECK (((resource_type = ''unattributed''::text) = (resource_id IS NULL)))' THEN
    RAISE EXCEPTION '039 postcondition: unattributed resource CHECK missing, unvalidated or different: %', coalesce(v_res, '<none>');
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_model FROM pg_constraint WHERE conrelid = 'public.platform_usage_events'::regclass AND conname = 'platform_usage_events_model_name_check' AND convalidated;
  IF v_model IS DISTINCT FROM 'CHECK (((model_name IS NOT NULL) OR (source_type = ''external_api''::text)))' THEN
    RAISE EXCEPTION '039 postcondition: model_name CHECK missing, unvalidated or different: %', coalesce(v_model, '<none>');
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_cost FROM pg_constraint WHERE conrelid = 'public.platform_usage_events'::regclass AND conname = 'platform_usage_events_total_cost_check' AND convalidated;
  IF v_cost IS NULL OR v_cost NOT LIKE '%total_cost >= (0)::numeric%' OR v_cost NOT LIKE '%NaN%' OR v_cost NOT LIKE '%Infinity%' THEN
    RAISE EXCEPTION '039 postcondition: total_cost CHECK missing, unvalidated or different: %', coalesce(v_cost, '<none>');
  END IF;
  IF (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.platform_usage_events'::regclass AND attname = 'resource_type') IS NOT TRUE THEN
    RAISE EXCEPTION '039 postcondition: resource_type must stay NOT NULL (the two-way CHECK relies on it)';
  END IF;
  IF (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.platform_usage_events'::regclass AND attname = 'idempotency_key') IS NOT TRUE
     OR to_regclass('public.platform_usage_events_idempotency_uidx') IS NULL THEN
    RAISE EXCEPTION '039 postcondition: idempotency_key must stay NOT NULL and uniquely indexed';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.platform_usage_events'::regclass) THEN
    RAISE EXCEPTION '039 postcondition: RLS must stay enabled on platform_usage_events';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(r, 'public.platform_usage_events', p) THEN
        RAISE EXCEPTION '039 postcondition: % still holds % on platform_usage_events', r, p;
      END IF;
    END LOOP;
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF has_any_column_privilege(r, 'public.platform_usage_events', p) THEN
        RAISE EXCEPTION '039 postcondition: % holds a column-level % on platform_usage_events', r, p;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
    IF NOT has_table_privilege('service_role', 'public.platform_usage_events', p) THEN
      RAISE EXCEPTION '039 postcondition: service_role lacks % on platform_usage_events', p;
    END IF;
  END LOOP;
END
$verify$;
