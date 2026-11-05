-- Prompt 3 / C3: two-person control for LOOSENING community execution policy (OD-2, LD-5).
--
-- NOT applied anywhere. Production application is NOT authorized: it needs an
-- explicit owner decision after review. Written for, and tested only on, a
-- disposable test database.
--
-- Pending-request columns on community_ai_platform_policy (nullable):
--   requested_execution_enabled, requested_auto_rules_enabled  the values requested
--   requested_by   the requesting operator
--   requested_at   server-stamped when the request is written
--   requested_base_execution_enabled, requested_base_auto_rules_enabled
--                  server-stamped with the row's flags when the request is
--                  written: the state the request was made against
--
-- Trigger community_ai_platform_policy_two_person (BEFORE INSERT OR UPDATE):
--   * A row cannot be INSERTED with execution_enabled or auto_rules_enabled
--     true: a new platform or tenant row starts closed and is opened by request
--     + confirmation. No row is ever auto-created.
--   * Writing a request (requested_by and at least one requested_* value)
--     stamps requested_at with the server clock. A request and the change it
--     asks for cannot be the same statement.
--   * An UPDATE that LOOSENS (execution_enabled or auto_rules_enabled false ->
--     true) is refused unless the row holds a request that:
--       - was made by someone else: updated_by (the confirmer, set by the
--         confirming statement) is not NULL and differs from requested_by;
--       - is younger than the TTL (1 hour, by the server clock);
--       - equals the change: the new execution_enabled / auto_rules_enabled
--         are exactly the requested values (an unrequested flag keeps its
--         current value).
--     Applying it clears the request.
--   * A confirmation is also refused unless the row's current flags still equal
--     the base the request was made against.
--   * Tightening (any flag true -> false) is single-operator and immediate, is
--     never blocked, and CLEARS any pending request in the same UPDATE: a
--     request made before a kill switch can never reopen execution after it.
--
-- ROLLBACK: supabase/migrations/rollbacks/community_policy_two_person_override_rollback.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'community_ai_platform_policy' AND column_name = 'organization_id') THEN
    RAISE EXCEPTION 'community policy two-person override: apply 20270126000000_community_tenant_execution_policy.sql first';
  END IF;
END
$$;

ALTER TABLE public.community_ai_platform_policy
  ADD COLUMN IF NOT EXISTS requested_execution_enabled boolean,
  ADD COLUMN IF NOT EXISTS requested_auto_rules_enabled boolean,
  ADD COLUMN IF NOT EXISTS requested_by uuid,
  ADD COLUMN IF NOT EXISTS requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS requested_base_execution_enabled boolean,
  ADD COLUMN IF NOT EXISTS requested_base_auto_rules_enabled boolean;

ALTER TABLE public.community_ai_platform_policy DROP CONSTRAINT IF EXISTS community_ai_platform_policy_request_shape;
ALTER TABLE public.community_ai_platform_policy
  ADD CONSTRAINT community_ai_platform_policy_request_shape
  CHECK (
    -- a pending request: who, when, what, and the flags it was made against
    (requested_by IS NOT NULL AND requested_at IS NOT NULL
     AND (requested_execution_enabled IS NOT NULL OR requested_auto_rules_enabled IS NOT NULL)
     AND requested_base_execution_enabled IS NOT NULL AND requested_base_auto_rules_enabled IS NOT NULL)
    OR
    -- no request: all six request columns NULL
    (requested_by IS NULL AND requested_at IS NULL
     AND requested_execution_enabled IS NULL AND requested_auto_rules_enabled IS NULL
     AND requested_base_execution_enabled IS NULL AND requested_base_auto_rules_enabled IS NULL));

CREATE OR REPLACE FUNCTION public.community_ai_platform_policy_two_person()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now       timestamptz := clock_timestamp();
  v_loosens   boolean;
  v_tightens  boolean;
  v_requested boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.execution_enabled IS TRUE OR NEW.auto_rules_enabled IS TRUE THEN
      RAISE EXCEPTION 'community_ai_platform_policy: a policy row starts closed; enable it by request and a second operator''s confirmation'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.requested_by IS NOT NULL THEN
      NEW.requested_at := v_now;
      NEW.requested_base_execution_enabled := NEW.execution_enabled;
      NEW.requested_base_auto_rules_enabled := NEW.auto_rules_enabled;
    ELSE
      NEW.requested_base_execution_enabled := NULL;
      NEW.requested_base_auto_rules_enabled := NULL;
    END IF;
    RETURN NEW;
  END IF;

  v_loosens := (OLD.execution_enabled IS NOT TRUE AND NEW.execution_enabled IS TRUE)
            OR (OLD.auto_rules_enabled IS NOT TRUE AND NEW.auto_rules_enabled IS TRUE);
  v_tightens := (OLD.execution_enabled IS TRUE AND NEW.execution_enabled IS NOT TRUE)
            OR (OLD.auto_rules_enabled IS TRUE AND NEW.auto_rules_enabled IS NOT TRUE);
  v_requested := NEW.requested_by IS DISTINCT FROM OLD.requested_by
              OR NEW.requested_execution_enabled IS DISTINCT FROM OLD.requested_execution_enabled
              OR NEW.requested_auto_rules_enabled IS DISTINCT FROM OLD.requested_auto_rules_enabled
              OR NEW.requested_at IS DISTINCT FROM OLD.requested_at;

  IF v_loosens THEN
    IF v_requested THEN
      RAISE EXCEPTION 'community_ai_platform_policy: a request and its confirmation cannot be the same change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.requested_by IS NULL
       OR OLD.requested_at IS NULL
       OR OLD.requested_at <= v_now - interval '1 hour'
       OR NEW.updated_by IS NULL
       OR NEW.updated_by = OLD.requested_by
       OR OLD.execution_enabled IS DISTINCT FROM OLD.requested_base_execution_enabled
       OR OLD.auto_rules_enabled IS DISTINCT FROM OLD.requested_base_auto_rules_enabled
       OR NEW.execution_enabled IS DISTINCT FROM coalesce(OLD.requested_execution_enabled, OLD.execution_enabled)
       OR NEW.auto_rules_enabled IS DISTINCT FROM coalesce(OLD.requested_auto_rules_enabled, OLD.auto_rules_enabled) THEN
      RAISE EXCEPTION 'community_ai_platform_policy: loosening needs a current request (under 1 hour) from another operator, confirmed exactly as requested'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.requested_execution_enabled  := NULL;
    NEW.requested_auto_rules_enabled := NULL;
    NEW.requested_by := NULL;
    NEW.requested_at := NULL;
    NEW.requested_base_execution_enabled := NULL;
    NEW.requested_base_auto_rules_enabled := NULL;
    RETURN NEW;
  END IF;

  IF v_tightens THEN
    NEW.requested_execution_enabled  := NULL;
    NEW.requested_auto_rules_enabled := NULL;
    NEW.requested_by := NULL;
    NEW.requested_at := NULL;
    NEW.requested_base_execution_enabled := NULL;
    NEW.requested_base_auto_rules_enabled := NULL;
    RETURN NEW;
  END IF;

  IF v_requested THEN
    IF NEW.requested_by IS NOT NULL
       AND NEW.requested_execution_enabled IS NULL AND NEW.requested_auto_rules_enabled IS NULL THEN
      NEW.requested_by := NULL; -- nothing requested: a withdrawal
    END IF;
    IF NEW.requested_by IS NOT NULL THEN
      NEW.requested_at := v_now;
      NEW.requested_base_execution_enabled := NEW.execution_enabled;
      NEW.requested_base_auto_rules_enabled := NEW.auto_rules_enabled;
    ELSE
      -- withdrawing a request clears all of it
      NEW.requested_execution_enabled  := NULL;
      NEW.requested_auto_rules_enabled := NULL;
      NEW.requested_at := NULL;
      NEW.requested_base_execution_enabled := NULL;
      NEW.requested_base_auto_rules_enabled := NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS community_ai_platform_policy_two_person ON public.community_ai_platform_policy;
CREATE TRIGGER community_ai_platform_policy_two_person
  BEFORE INSERT OR UPDATE ON public.community_ai_platform_policy
  FOR EACH ROW EXECUTE FUNCTION public.community_ai_platform_policy_two_person();

REVOKE EXECUTE ON FUNCTION public.community_ai_platform_policy_two_person() FROM PUBLIC, anon, authenticated;

-- Postconditions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.community_ai_platform_policy'::regclass
                    AND tgname = 'community_ai_platform_policy_two_person' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'community policy two-person override postcondition: trigger missing';
  END IF;
END
$$;
