-- ════════════════════════════════════════════════════════════════════════════
-- PROPOSAL — Closure-015N (R-16). NOT A MIGRATION until promoted (see
-- docs/security/CLOSURE_015N_MIGRATION_SEQUENCE_AND_R16.md §2). Validated only on
-- a throwaway PostgreSQL loaded from the repository schema files.
--
-- R-16 ROOT CAUSE (reproduced on the baseline schema):
--   1. 42702 — `column reference "company_id" is ambiguous`: RETURNS TABLE(…
--      company_id …) makes company_id a PL/pgSQL variable, and the unqualified
--      ON CONFLICT (user_id, company_id) collides with it.
--   2. 42P10 — even with the ambiguity resolved, ON CONFLICT (user_id, company_id)
--      needs a unique index/constraint on exactly those columns. None exists, and
--      none ever did: 20260420_lockdown_idempotency wrote the upsert against an
--      assumed full uniqueness. The schema's established invariant is
--      20260406_multi_tenant_auth_migration §8c — at most ONE ACTIVE membership
--      per (user, company): idx_user_company_roles_user_company_active
--      (user_id, company_id) WHERE status = 'active'. Non-active rows (invited,
--      inactive, expired) may legitimately coexist. So the fix adds NO constraint;
--      the upsert infers that partial index explicitly.
--   Effect today: every invitation activation through auth/set-password fails.
--
-- ALSO CLOSED (the baseline body, had it run, would have):
--   • re-activated an already-ACCEPTED invitation on every call (no single use);
--   • accepted for any p_user_id (no binding to the invitee's email);
--   • overwritten an existing SUPER_ADMIN membership with the invitation role
--     (ON CONFLICT DO UPDATE SET role = EXCLUDED.role) — removing platform
--     authority outside identity.admin.revoke;
--   • changed the role of an ALREADY-ACTIVE member;
--   • activated memberships in disabled / soft-deleted companies.
--
-- SIGNATURE AND RESULT SHAPE ARE UNCHANGED (caller: pages/api/auth/set-password.ts
-- reads activation.company_id), so CREATE OR REPLACE keeps the existing grants
-- (20261026000000_close_anon_rls_exposure revoked anon/authenticated).
--
-- LOCK ORDER: invitations row FOR UPDATE → companies row FOR SHARE →
-- user_company_roles rows FOR UPDATE. Lifecycle functions take companies first and
-- never lock invitations, so no cycle is introduced.
--
-- RE-RUN: idempotent (CREATE OR REPLACE). The precondition block below refuses
-- with a clear diagnostic if the required partial unique index is absent or has a
-- different shape.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Precondition: the invariant this function relies on must exist exactly ──
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'idx_user_company_roles_user_company_active'
     AND i.indrelid = 'public.user_company_roles'::regclass;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'R16_PRECONDITION_FAILED: unique index idx_user_company_roles_user_company_active is missing (expected UNIQUE (user_id, company_id) WHERE status = ''active'', 20260406_multi_tenant_auth_migration §8c)';
  END IF;
  IF v_def NOT ILIKE 'CREATE UNIQUE INDEX%(user_id, company_id)%WHERE (status = ''active''::text)%' THEN
    RAISE EXCEPTION 'R16_PRECONDITION_FAILED: idx_user_company_roles_user_company_active has an unexpected definition: %', v_def;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.activate_invitation_membership(
  p_invitation_id uuid,
  p_user_id uuid,
  p_now timestamp with time zone DEFAULT now()
)
RETURNS TABLE(invitation_id uuid, company_id uuid, role text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_inv          public.invitations%ROWTYPE;
  v_role         text;
  v_email        text;
  v_c_status     text;
  v_c_deleted    timestamptz;
  v_row_id       uuid;
  v_row_role     text;
  v_row_status   text;
  v_active_count integer;
  v_sa_count     integer;
BEGIN
  -- 1. The invitation, locked: concurrent acceptances of the SAME invitation serialize here.
  SELECT inv.* INTO v_inv
    FROM public.invitations inv
   WHERE inv.id = p_invitation_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVITATION_REVOKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.expires_at IS NULL OR v_inv.expires_at <= p_now THEN
    -- (The caller, auth/set-password, revokes an expired invitation itself; a
    -- RAISE here rolls back any write in this function, so none is attempted.)
    RAISE EXCEPTION 'INVITATION_EXPIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.token_consumed_at IS NULL THEN
    RAISE EXCEPTION 'INVITATION_NOT_CONSUMED' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Single use. A replay by the SAME accepting user whose membership is already
  --    active is idempotent (same result, no write); anything else is refused.
  IF v_inv.accepted_at IS NOT NULL THEN
    IF v_inv.accepted_by IS NOT DISTINCT FROM p_user_id
       AND EXISTS (SELECT 1 FROM public.user_company_roles r
                    WHERE r.user_id = p_user_id AND r.company_id = v_inv.company_id AND r.status = 'active') THEN
      RETURN QUERY SELECT v_inv.id, v_inv.company_id, v_inv.role;
      RETURN;
    END IF;
    RAISE EXCEPTION 'INVITATION_ALREADY_ACCEPTED' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Bound to the invitee: the accepting user's email must be the invited email.
  SELECT u.email INTO v_email FROM public.users u WHERE u.id = p_user_id;
  IF v_email IS NULL OR lower(btrim(v_email)) <> lower(btrim(v_inv.email)) THEN
    RAISE EXCEPTION 'INVITATION_USER_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Only an invitation role (invitations_role_check); never SUPER_ADMIN.
  v_role := upper(btrim(v_inv.role));
  IF v_role IS NULL OR v_role NOT IN ('COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY') THEN
    RAISE EXCEPTION 'INVITATION_ROLE_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;

  -- 5. The company must be live (lifecycle model: status is the operational flag,
  --    deleted_at the tombstone). FOR SHARE: serializes with disable / delete.
  SELECT c.status, c.deleted_at INTO v_c_status, v_c_deleted
    FROM public.companies c WHERE c.id = v_inv.company_id
     FOR SHARE;
  IF NOT FOUND OR v_c_deleted IS NOT NULL OR v_c_status <> 'active' THEN
    RAISE EXCEPTION 'INVITATION_COMPANY_NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  -- 6. The pair's membership rows, locked. Tenant isolation: (user, company) only.
  SELECT count(*) FILTER (WHERE upper(btrim(r.role)) = 'SUPER_ADMIN'),
         count(*) FILTER (WHERE r.status = 'active')
    INTO v_sa_count, v_active_count
    FROM (SELECT r2.role, r2.status FROM public.user_company_roles r2
           WHERE r2.user_id = p_user_id AND r2.company_id = v_inv.company_id
             FOR UPDATE) r;
  IF v_sa_count > 0 THEN
    -- A SUPER_ADMIN row (any status) is changed only by identity.admin.assign / revoke.
    RAISE EXCEPTION 'INVITATION_TARGETS_SUPER_ADMIN_MEMBERSHIP' USING ERRCODE = 'P0001';
  END IF;
  IF v_active_count > 0 THEN
    -- An active member is not re-roled by an invitation (Closure-015J R-13 policy).
    RAISE EXCEPTION 'MEMBERSHIP_ALREADY_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.id, r.role, r.status INTO v_row_id, v_row_role, v_row_status
    FROM public.user_company_roles r
   WHERE r.user_id = p_user_id AND r.company_id = v_inv.company_id
   ORDER BY (r.status = 'invited') DESC, r.created_at DESC NULLS LAST
   LIMIT 1;

  IF v_row_id IS NOT NULL THEN
    -- Activate the existing non-active row (invited / inactive / expired), as read.
    UPDATE public.user_company_roles r
       SET role = v_role, status = 'active', join_source = 'invited',
           accepted_at = p_now, deactivated_at = NULL, updated_at = p_now
     WHERE r.id = v_row_id AND r.status IS NOT DISTINCT FROM v_row_status;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'MEMBERSHIP_CHANGED_CONCURRENTLY' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- No row: insert. The ONE established invariant — at most one ACTIVE row per
    -- (user, company) — is the explicit inference target; a concurrent activation
    -- by another path makes this a no-op, reported as such.
    INSERT INTO public.user_company_roles
      (user_id, company_id, role, status, join_source, accepted_at, created_at, updated_at)
    VALUES
      (p_user_id, v_inv.company_id, v_role, 'active', 'invited', p_now, p_now, p_now)
    ON CONFLICT (user_id, company_id) WHERE status = 'active' DO NOTHING
    RETURNING id INTO v_row_id;
    IF v_row_id IS NULL THEN
      RAISE EXCEPTION 'MEMBERSHIP_ALREADY_ACTIVE' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 7. Consume the invitation (single use) and point the user at the company.
  UPDATE public.invitations inv
     SET accepted_at = p_now, accepted_by = p_user_id
   WHERE inv.id = v_inv.id AND inv.accepted_at IS NULL;

  UPDATE public.users u
     SET active_company_id = v_inv.company_id
   WHERE u.id = p_user_id;

  RETURN QUERY SELECT v_inv.id, v_inv.company_id, v_role;
END;
$$;

COMMIT;

-- ROLLBACK: re-apply the baseline body of public.activate_invitation_membership from
-- supabase/_schema/baseline.sql (it is non-functional: 42702 / 42P10). No data,
-- constraint or index is created or changed by this file.
