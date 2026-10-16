-- ROLLBACK for 20261210000004_activate_invitation_membership.sql
--
-- ############################################################################
-- #  WARNING — RESTORES A FUNCTION THAT CANNOT RUN                            #
-- ############################################################################
-- The baseline body fails with 42702 (ambiguous company_id) and, past that, 42P10 (no unique
-- constraint matches its ON CONFLICT). Rolling back R-16 therefore means invitation activation
-- through auth/set-password is BROKEN again (every call → 500). It also restores the unsafe
-- semantics the baseline body would have had (no single use, no invitee binding, a SUPER_ADMIN
-- row overwritten by the invitation role). Prefer fixing forward. No data, constraint or index changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.activate_invitation_membership(p_invitation_id uuid, p_user_id uuid, p_now timestamp with time zone DEFAULT now()) RETURNS TABLE(invitation_id uuid, company_id uuid, role text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_invitation invitations%ROWTYPE;
BEGIN
  SELECT *
  INTO v_invitation
  FROM invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND';
  END IF;

  IF v_invitation.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVITATION_REVOKED';
  END IF;

  IF v_invitation.expires_at <= p_now THEN
    UPDATE invitations
    SET revoked_at = COALESCE(revoked_at, p_now)
    WHERE id = p_invitation_id;
    RAISE EXCEPTION 'INVITATION_EXPIRED';
  END IF;

  IF v_invitation.token_consumed_at IS NULL THEN
    RAISE EXCEPTION 'INVITATION_NOT_CONSUMED';
  END IF;

  IF v_invitation.accepted_at IS NULL THEN
    UPDATE invitations
    SET accepted_at = p_now,
        accepted_by = p_user_id
    WHERE id = p_invitation_id;
  END IF;

  INSERT INTO user_company_roles (
    user_id,
    company_id,
    role,
    status,
    join_source,
    accepted_at,
    created_at,
    updated_at
  )
  VALUES (
    p_user_id,
    v_invitation.company_id,
    v_invitation.role,
    'active',
    'invited',
    p_now,
    p_now,
    p_now
  )
  ON CONFLICT (user_id, company_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    status = 'active',
    join_source = 'invited',
    accepted_at = p_now,
    updated_at = p_now;

  UPDATE users
  SET active_company_id = v_invitation.company_id
  WHERE id = p_user_id;

  RETURN QUERY
  SELECT v_invitation.id, v_invitation.company_id, v_invitation.role;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_invitation_membership(uuid, uuid, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_invitation_membership(uuid, uuid, timestamp with time zone) TO service_role;

COMMIT;
