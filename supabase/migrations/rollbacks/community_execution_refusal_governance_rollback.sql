-- ROLLBACK for 20270126000002_community_execution_refusal_governance.sql
--
-- NOT applied anywhere. Production application is NOT authorized.
--
-- Drops record_community_execution_refusal and the refusal_key index, and
-- restores the previous event_type CHECK (without
-- 'skipped_due_to_platform_policy').
--
-- REFUSES (raises, changing nothing):
--   * while claim_community_ai_action_for_execution exists: the claim writes
--     its refusals through this function; roll back
--     20270126000001_community_action_approval_claim.sql first;
--   * while any 'skipped_due_to_platform_policy' record exists: refusal
--     records are governance records and are never deleted by a rollback, and
--     the narrower CHECK cannot hold them.
-- Run inside a transaction; every refusal aborts it.

DO $$
DECLARE
  v_n bigint;
BEGIN
  IF to_regprocedure('public.claim_community_ai_action_for_execution(uuid,uuid,uuid,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'community execution refusal governance rollback: claim_community_ai_action_for_execution still records refusals here; roll back 20270126000001 first';
  END IF;
  SELECT count(*) INTO v_n FROM public.community_ai_action_logs WHERE event_type = 'skipped_due_to_platform_policy';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'community execution refusal governance rollback: % policy refusal records exist; they are never deleted and the previous CHECK cannot hold them', v_n;
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.record_community_execution_refusal(uuid, uuid, uuid, text, text, uuid, jsonb);
DROP INDEX IF EXISTS public.uq_community_ai_action_logs_refusal_key;
ALTER TABLE public.community_ai_action_logs DROP CONSTRAINT IF EXISTS community_ai_action_logs_event_type_check;
ALTER TABLE public.community_ai_action_logs
  ADD CONSTRAINT community_ai_action_logs_event_type_check
  CHECK (event_type = ANY (ARRAY['approved'::text, 'executed'::text, 'failed'::text, 'skipped'::text,
                                 'scheduled'::text, 'auto_executed'::text]));
