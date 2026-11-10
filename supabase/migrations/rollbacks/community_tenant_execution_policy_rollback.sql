-- ROLLBACK for 20270126000000_community_tenant_execution_policy.sql
--
-- NOT applied anywhere. Production application is NOT authorized.
--
-- Drops community_execution_policy_decision, the policy touch trigger, the
-- scope CHECK and unique indexes and the organization_id / tenant_id columns,
-- and restores the OPEN column defaults (execution_enabled true,
-- auto_rules_enabled true, require_human_approval false). Open defaults let a
-- newly inserted policy row enable execution, so this rollback REFUSES
-- (raises, changing nothing) unless the operator acknowledges it in the same
-- transaction:
--   SET LOCAL omnivyra.community_tenant_execution_policy_restore_open = 'i-accept-open-execution-defaults';
--
-- Also REFUSES:
--   * while claim_community_ai_action_for_execution or the two-person trigger
--     exists (roll back 20270126000001 and 20270126000003 first);
--   * while any TENANT row exists: dropping the columns would turn it into a
--     second global row. Tenant rows are an operator decision and are never
--     deleted by a rollback.
-- Run inside a transaction; every refusal aborts it.

DO $$
DECLARE
  v_n bigint;
BEGIN
  IF coalesce(current_setting('omnivyra.community_tenant_execution_policy_restore_open', true), '')
       <> 'i-accept-open-execution-defaults' THEN
    RAISE EXCEPTION 'community tenant execution policy rollback: restoring open defaults; set omnivyra.community_tenant_execution_policy_restore_open to acknowledge';
  END IF;
  IF to_regprocedure('public.claim_community_ai_action_for_execution(uuid,uuid,uuid,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'community tenant execution policy rollback: roll back 20270126000001 first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.community_ai_platform_policy'::regclass
                AND tgname = 'community_ai_platform_policy_two_person') THEN
    RAISE EXCEPTION 'community tenant execution policy rollback: roll back 20270126000003 first';
  END IF;
  SELECT count(*) INTO v_n FROM public.community_ai_platform_policy WHERE organization_id IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'community tenant execution policy rollback: % tenant policy rows exist; they are never deleted by a rollback', v_n;
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.community_execution_policy_decision(uuid, uuid);
DROP TRIGGER IF EXISTS community_ai_platform_policy_touch ON public.community_ai_platform_policy;
DROP FUNCTION IF EXISTS public.community_ai_platform_policy_touch();
DROP INDEX IF EXISTS public.uq_community_ai_platform_policy_org;
DROP INDEX IF EXISTS public.uq_community_ai_platform_policy_platform_row;
ALTER TABLE public.community_ai_platform_policy DROP CONSTRAINT IF EXISTS community_ai_platform_policy_scope;
ALTER TABLE public.community_ai_platform_policy
  DROP COLUMN IF EXISTS organization_id,
  DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.community_ai_platform_policy ALTER COLUMN execution_enabled SET DEFAULT true;
ALTER TABLE public.community_ai_platform_policy ALTER COLUMN auto_rules_enabled SET DEFAULT true;
ALTER TABLE public.community_ai_platform_policy ALTER COLUMN require_human_approval SET DEFAULT false;
