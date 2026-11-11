-- Prompt 3 / C3: community execution refusal records (OD-3 governance record, LD-6).
--
-- NOT applied anywhere. Production application is NOT authorized: it needs an
-- explicit owner decision after review. Written for, and tested only on, a
-- disposable test database.
--
-- 1. community_ai_action_logs.event_type CHECK widened with
--    'skipped_due_to_platform_policy'. The executor already writes that event
--    type for policy refusals and the old CHECK rejected it (the insert failed
--    and the refusal was lost: a confirmed defect). Nothing else changes.
-- 2. Partial unique index on event_payload->>'refusal_key' (rows that carry
--    one): a refusal is recorded once, however often it is retried.
-- 3. record_community_execution_refusal(action, org, tenant, claim_point, code,
--    actor, payload) -> boolean. Inserts ONE refusal record and returns true,
--    or returns false when the same refusal is already recorded (ON CONFLICT
--    DO NOTHING). It never drops a record silently: an unknown action, or an
--    action of another organization, RAISES; the record is always written
--    under the action row's own tenant (p_tenant is checked against it only
--    for consistency and a mismatch also RAISES). event_type is 'skipped_due_to_platform_policy' for policy codes
--    (POLICY_* and PLATFORM_KILL_SWITCH) and 'skipped' for every other code:
--    it can never write 'approved' or any other event type.
--      refusal_key = sha256(action_id|claim_point|code|approved_at or 'none'|
--                           policy_state)
--    approved_at is read from the row (ISO-8601 UTC milliseconds).
--    policy_state is the EFFECTIVE flag values of the platform row and the
--    tenant row ('p:<exec>,<auto>;t:<exec>,<auto>', 'none' for a missing row),
--    not their updated_at: request bookkeeping that changes no flag does not
--    create a second record for the same refusal. The key and the
--    fields it is built from overwrite any same-named keys in p_payload.
--
-- Grants: service_role only (REVOKE from PUBLIC, anon, authenticated).
-- ROLLBACK: supabase/migrations/rollbacks/community_execution_refusal_governance_rollback.sql

DO $$
BEGIN
  IF to_regclass('public.community_ai_action_logs') IS NULL THEN
    RAISE EXCEPTION 'community execution refusal governance: public.community_ai_action_logs is absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'community_ai_platform_policy' AND column_name = 'organization_id') THEN
    RAISE EXCEPTION 'community execution refusal governance: apply 20270126000000_community_tenant_execution_policy.sql first';
  END IF;
END
$$;

ALTER TABLE public.community_ai_action_logs DROP CONSTRAINT IF EXISTS community_ai_action_logs_event_type_check;
ALTER TABLE public.community_ai_action_logs
  ADD CONSTRAINT community_ai_action_logs_event_type_check
  CHECK (event_type = ANY (ARRAY['approved'::text, 'executed'::text, 'failed'::text, 'skipped'::text,
                                 'scheduled'::text, 'auto_executed'::text, 'skipped_due_to_platform_policy'::text]));

CREATE UNIQUE INDEX IF NOT EXISTS uq_community_ai_action_logs_refusal_key
  ON public.community_ai_action_logs ((event_payload ->> 'refusal_key'))
  WHERE (event_payload ? 'refusal_key');

CREATE OR REPLACE FUNCTION public.record_community_execution_refusal(
  p_action_id   uuid,
  p_org         uuid,
  p_tenant      uuid,
  p_claim_point text,
  p_code        text,
  p_actor       uuid,
  p_payload     jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_approved_at timestamptz;
  v_row_org     uuid;
  v_row_tenant  uuid;
  v_plat        text;
  v_ten         text;
  v_at_txt      text;
  v_ver_txt     text;
  v_key         text;
  v_type        text;
  v_n           integer;
BEGIN
  IF p_action_id IS NULL OR p_org IS NULL OR p_tenant IS NULL
     OR coalesce(btrim(p_claim_point), '') = '' OR coalesce(btrim(p_code), '') = '' THEN
    RAISE EXCEPTION 'record_community_execution_refusal: action, organization, tenant, claim point and code are required';
  END IF;

  SELECT a.approved_at, a.organization_id, a.tenant_id INTO v_approved_at, v_row_org, v_row_tenant
    FROM community_ai_actions a
   WHERE a.id = p_action_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_community_execution_refusal: action % does not exist', p_action_id;
  END IF;
  IF v_row_org IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'record_community_execution_refusal: action % does not belong to organization %', p_action_id, p_org;
  END IF;
  IF v_row_tenant IS DISTINCT FROM p_tenant THEN
    RAISE EXCEPTION 'record_community_execution_refusal: action % belongs to another tenant than %; pass the row''s tenant_id', p_action_id, p_tenant;
  END IF;
  SELECT string_agg(p.execution_enabled::text || ',' || p.auto_rules_enabled::text, '|' ORDER BY p.id) INTO v_plat
    FROM community_ai_platform_policy p WHERE p.organization_id IS NULL;
  SELECT string_agg(p.execution_enabled::text || ',' || p.auto_rules_enabled::text, '|' ORDER BY p.id) INTO v_ten
    FROM community_ai_platform_policy p WHERE p.organization_id = v_row_org;

  v_at_txt  := coalesce(to_char(v_approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'none');
  v_ver_txt := 'p:' || coalesce(v_plat, 'none') || ';t:' || coalesce(v_ten, 'none');
  v_key := encode(sha256(convert_to(
             p_action_id::text || '|' || p_claim_point || '|' || p_code || '|' || v_at_txt || '|' || v_ver_txt, 'UTF8')), 'hex');
  v_type := CASE WHEN p_code LIKE 'POLICY\_%' OR p_code = 'PLATFORM_KILL_SWITCH'
                 THEN 'skipped_due_to_platform_policy' ELSE 'skipped' END;

  INSERT INTO community_ai_action_logs (action_id, tenant_id, organization_id, event_type, event_payload)
  VALUES (p_action_id, v_row_tenant, v_row_org, v_type,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
            'refusal_key', v_key,
            'refusal', true,
            'code', p_code,
            'claim_point', p_claim_point,
            'actor', p_actor,
            'approved_at', v_at_txt,
            'policy_state', v_ver_txt))
  ON CONFLICT ((event_payload ->> 'refusal_key')) WHERE (event_payload ? 'refusal_key') DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END
$$;

COMMENT ON FUNCTION public.record_community_execution_refusal(uuid, uuid, uuid, text, text, uuid, jsonb) IS
  'community_execution_refusal_governance: one refusal record per (action, claim point, code, approval, policy version); skipped or skipped_due_to_platform_policy only.';

REVOKE EXECUTE ON FUNCTION public.record_community_execution_refusal(uuid, uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_community_execution_refusal(uuid, uuid, uuid, text, text, uuid, jsonb) TO service_role;

-- Postconditions
DO $$
DECLARE
  f regprocedure := to_regprocedure('public.record_community_execution_refusal(uuid,uuid,uuid,text,text,uuid,jsonb)');
BEGIN
  IF f IS NULL OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = f) THEN
    RAISE EXCEPTION 'community execution refusal governance postcondition: record function absent or not SECURITY DEFINER';
  END IF;
  IF to_regclass('public.uq_community_ai_action_logs_refusal_key') IS NULL THEN
    RAISE EXCEPTION 'community execution refusal governance postcondition: refusal_key index is missing';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint
                            WHERE conrelid = 'public.community_ai_action_logs'::regclass
                              AND conname = 'community_ai_action_logs_event_type_check')) NOT LIKE '%skipped_due_to_platform_policy%' THEN
    RAISE EXCEPTION 'community execution refusal governance postcondition: event_type CHECK not widened';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND has_function_privilege('anon', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'community execution refusal governance postcondition: anon can execute the record function';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'community execution refusal governance postcondition: authenticated can execute the record function';
  END IF;
END
$$;
