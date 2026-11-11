-- ROLLBACK for 20270126000003_community_policy_two_person_override.sql
--
-- NOT applied anywhere. Production application is NOT authorized.
--
-- Drops the two-person trigger and the pending-request columns. Without the
-- trigger ONE operator can enable execution or auto rules for a tenant or for
-- the whole platform, so this rollback REFUSES (raises, changing nothing)
-- unless the operator acknowledges it in the same transaction:
--   SET LOCAL omnivyra.community_policy_two_person_drop = 'i-accept-single-operator-enable';
-- A pending request is discarded with the columns.
-- Run inside a transaction; every refusal aborts it.

DO $$
BEGIN
  IF coalesce(current_setting('omnivyra.community_policy_two_person_drop', true), '')
       <> 'i-accept-single-operator-enable' THEN
    RAISE EXCEPTION 'community policy two-person override rollback: dropping it lets one operator enable execution; set omnivyra.community_policy_two_person_drop to acknowledge';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS community_ai_platform_policy_two_person ON public.community_ai_platform_policy;
DROP FUNCTION IF EXISTS public.community_ai_platform_policy_two_person();
ALTER TABLE public.community_ai_platform_policy DROP CONSTRAINT IF EXISTS community_ai_platform_policy_request_shape;
ALTER TABLE public.community_ai_platform_policy
  DROP COLUMN IF EXISTS requested_execution_enabled,
  DROP COLUMN IF EXISTS requested_auto_rules_enabled,
  DROP COLUMN IF EXISTS requested_by,
  DROP COLUMN IF EXISTS requested_at,
  DROP COLUMN IF EXISTS requested_base_execution_enabled,
  DROP COLUMN IF EXISTS requested_base_auto_rules_enabled;
