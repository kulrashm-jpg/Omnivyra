-- ROLLBACK for 20261210000002_assign_super_admin_rpc_and_direct_grant_guard.sql
-- Effect: (1) the direct application-role SUPER_ADMIN grant restriction is removed — the guard
-- function returns to its exact 20261210000001 body (company lifecycle check only); (2) the governed
-- RPC is dropped, so bootstrap-super-admin falls back to its two-statement grant (PGRST202). The
-- lifecycle invariant is still enforced by the 20261210000001 trigger, but the direct-UPDATE deadlock
-- window (40P01, safe) returns for grants. Data-lossless. Step (1) runs before (2) in one transaction,
-- so there is no moment where the RPC is gone but direct grants are still refused.

BEGIN;
CREATE OR REPLACE FUNCTION public.guard_super_admin_membership_company()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status  text;
  v_deleted timestamptz;
BEGIN
  -- Only writes that PRODUCE an active SUPER_ADMIN row are guarded.
  IF NEW.status IS DISTINCT FROM 'active' OR upper(btrim(NEW.role)) <> 'SUPER_ADMIN' THEN
    RETURN NEW;
  END IF;
  -- No transition: the row already was an active SUPER_ADMIN of this company
  -- (e.g. an updated_at touch). Lifecycle step 2 already sees it.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'active'
     AND upper(btrim(OLD.role)) = 'SUPER_ADMIN'
     AND OLD.company_id = NEW.company_id THEN
    RETURN NEW;
  END IF;

  SELECT c.status, c.deleted_at
    INTO v_status, v_deleted
    FROM public.companies c
   WHERE c.id = NEW.company_id
     FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPER_ADMIN_MEMBERSHIP_COMPANY_MISSING'
      USING ERRCODE = 'P0001',
            DETAIL  = format('company %s does not exist', NEW.company_id);
  END IF;
  IF v_deleted IS NOT NULL OR v_status <> 'active' THEN
    RAISE EXCEPTION 'SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE'
      USING ERRCODE = 'P0001',
            DETAIL  = format('company %s status=%s soft_deleted=%s', NEW.company_id, v_status, v_deleted IS NOT NULL);
  END IF;
  RETURN NEW;
END;
$$;
DROP FUNCTION IF EXISTS public.assign_super_admin(uuid, uuid);
COMMIT;
