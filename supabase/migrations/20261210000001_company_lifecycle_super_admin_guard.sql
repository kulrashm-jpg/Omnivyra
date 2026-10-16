-- Promoted by Closure-015O from supabase/proposals/closure015n/01_company_lifecycle_super_admin_guard.sql (sha256 2f5fb8318190d234536a08b9e222167495eeb40e7191a125dde527b576cbaac8).
-- Adjustments vs the proposal (if any) are listed in docs/security/CLOSURE_015O_MIGRATION_PROMOTION_REVIEW.md §4.
-- ════════════════════════════════════════════════════════════════════════════
-- PROPOSAL — Closure-015L. NOT A MIGRATION.
--
-- Deliberately outside supabase/migrations: no tooling, deploy step or
-- `supabase db push` picks this file up. It has NOT been executed against any
-- database. Promotion to a dated migration needs explicit authorization plus the
-- preconditions in docs/security/CLOSURE_015L_DATABASE_GUARDS_AND_RBAC_SCHEMA.md
-- §4, and the real-Postgres tests in
-- backend/tests/realschema/closure015l_company_lifecycle_guard.test.ts must pass
-- on a disposable database first.
--
-- INVARIANT
--   A company lifecycle operation (disable, soft delete, hard delete) never
--   deactivates or deletes an ACTIVE SUPER_ADMIN membership, and never completes
--   while the company holds one — including one created or activated
--   concurrently.
--
-- MECHANISM — one serialization point: the companies row.
--   Lifecycle side (the functions below):
--     1. SELECT … FROM companies WHERE id = $1 FOR UPDATE   (lock first)
--     2. refuse if an active SUPER_ADMIN membership exists  (fresh snapshot)
--     3. do the work in the same transaction
--   Writer side (trigger on user_company_roles), for every INSERT / UPDATE that
--   PRODUCES an active SUPER_ADMIN row, whichever application path issues it:
--     SELECT … FROM companies WHERE id = NEW.company_id FOR SHARE, and refuse
--     unless the company exists, is 'active' and is not soft-deleted.
--   FOR UPDATE and FOR SHARE conflict, so the two sides serialize on the row:
--     • writer first: lifecycle step 1 waits for the writer's commit; step 2
--       (a new statement under READ COMMITTED) then sees the committed active
--       SUPER_ADMIN row → RAISE → the whole lifecycle transaction rolls back;
--     • lifecycle first: the writer's FOR SHARE waits for the lifecycle
--       commit; it then sees status 'inactive' / deleted_at set / no row
--       (hard delete) → RAISE → the write rolls back. No orphan can remain.
--   Two writers both take FOR SHARE and do not block each other.
--
-- DEADLOCK
--   A writer that UPDATEs an existing membership row locks that row (the row
--   lock is taken before BEFORE ROW triggers fire) and only then takes the
--   company FOR SHARE. If the lifecycle transaction already holds the company and
--   then reaches the same membership row, the two wait on each other. Postgres
--   detects this (40P01, after deadlock_timeout) and aborts ONE of them; either
--   outcome preserves the invariant (see the design doc §2.4). To remove the
--   deadlock entirely the governed writer locks the company FIRST — see
--   02_assign_super_admin_rpc.sql (recommended, not required for safety).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Writer-side guard ─────────────────────────────────────────────────────
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

DROP TRIGGER IF EXISTS trg_guard_super_admin_membership_company ON public.user_company_roles;
CREATE TRIGGER trg_guard_super_admin_membership_company
  BEFORE INSERT OR UPDATE OF role, status, company_id ON public.user_company_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_super_admin_membership_company();

-- ── 2. Disable (also the first half of soft delete) ─────────────────────────
-- Body identical to supabase/_schema/baseline.sql except the marked additions.
-- search-path-ok: body and settings kept identical to the baseline function (unpinned since 20260640) as reviewed and real-Postgres validated in Closure-015L/M/N; pinning is a tracked follow-up (015O report §4).
CREATE OR REPLACE FUNCTION public.disable_company_cascade(p_company_id uuid, p_actor uuid, p_reason text)
RETURNS TABLE(affected_users integer, revoked_roles integer, revoked_sessions integer)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_now              TIMESTAMPTZ := NOW();
  v_affected_users   INTEGER     := 0;
  v_revoked_roles    INTEGER     := 0;
  v_revoked_sessions INTEGER     := 0;
  v_super_admins     INTEGER     := 0;   -- Closure-015L
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'DISABLE_COMPANY_CASCADE_NULL_COMPANY';
  END IF;
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) = 0 THEN
    RAISE EXCEPTION 'DISABLE_COMPANY_CASCADE_MISSING_REASON';
  END IF;

  -- Closure-015L: serialization point (lock FIRST), then the protected check.
  PERFORM 1 FROM companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*) INTO v_super_admins
    FROM user_company_roles
   WHERE company_id = p_company_id
     AND status = 'active'
     AND upper(btrim(role)) = 'SUPER_ADMIN';
  IF v_super_admins > 0 THEN
    RAISE EXCEPTION 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP'
      USING ERRCODE = 'P0001',
            DETAIL  = format('%s active SUPER_ADMIN membership(s); revoke through identity.admin.revoke first', v_super_admins);
  END IF;

  UPDATE companies
    SET status = 'inactive'
    WHERE id = p_company_id;

  -- Lock + flip every active membership; capture user_ids for cascade.
  -- Closure-015L: RETURNING role as a second, in-statement check (defence in
  -- depth; under the company lock no active SUPER_ADMIN can appear here).
  WITH affected AS (
    UPDATE user_company_roles
      SET status = 'inactive',
          deactivated_at = v_now,
          updated_at = v_now
      WHERE company_id = p_company_id
        AND status = 'active'
      RETURNING user_id, role
  )
  SELECT COUNT(*), COUNT(*) FILTER (WHERE upper(btrim(role)) = 'SUPER_ADMIN')
    INTO v_revoked_roles, v_super_admins
    FROM affected;
  IF v_super_admins > 0 THEN
    RAISE EXCEPTION 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP' USING ERRCODE = 'P0001';
  END IF;

  -- Compute distinct user ids in a subsequent statement (Postgres CTE
  -- limitation around mixing INSERT/UPDATE return + reuse).
  WITH affected_users AS (
    SELECT DISTINCT user_id
    FROM user_company_roles
    WHERE company_id = p_company_id
      AND status = 'inactive'
      AND deactivated_at = v_now
  ),
  bumped AS (
    UPDATE users
      SET session_revoked_after = v_now,
          updated_at = v_now
      WHERE id IN (SELECT user_id FROM affected_users)
      RETURNING id
  ),
  revoked AS (
    UPDATE auth_sessions
      SET revoked_at = v_now,
          revocation_reason = p_reason
      WHERE user_id IN (SELECT user_id FROM affected_users)
        AND revoked_at IS NULL
      RETURNING id
  )
  SELECT
    (SELECT COUNT(*) FROM bumped),
    (SELECT COUNT(*) FROM revoked)
  INTO v_affected_users, v_revoked_sessions;

  RETURN QUERY SELECT v_affected_users, v_revoked_roles, v_revoked_sessions;
END;
$$;

-- soft_delete_company(uuid, uuid, text) is UNCHANGED: it calls
-- disable_company_cascade first (which now locks the company and refuses), and
-- an exception there rolls back its deleted_at update as well. After it commits,
-- deleted_at IS NOT NULL makes the trigger refuse any new active SUPER_ADMIN.

-- ── 3. Hard delete — one transaction instead of three app-side statements ───
CREATE OR REPLACE FUNCTION public.hard_delete_company(p_company_id uuid, p_actor uuid, p_reason text)
RETURNS TABLE(deleted_memberships integer, deleted_profiles integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_super_admins INTEGER := 0;
  v_memberships  INTEGER := 0;
  v_profiles     INTEGER := 0;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'HARD_DELETE_COMPANY_NULL_COMPANY';
  END IF;
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) = 0 THEN
    RAISE EXCEPTION 'HARD_DELETE_COMPANY_MISSING_REASON';
  END IF;

  PERFORM 1 FROM companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*) INTO v_super_admins
    FROM user_company_roles
   WHERE company_id = p_company_id
     AND status = 'active'
     AND upper(btrim(role)) = 'SUPER_ADMIN';
  IF v_super_admins > 0 THEN
    RAISE EXCEPTION 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP'
      USING ERRCODE = 'P0001',
            DETAIL  = format('%s active SUPER_ADMIN membership(s); revoke through identity.admin.revoke first', v_super_admins);
  END IF;

  -- Non-active SUPER_ADMIN rows confer nothing and are removed with the rest.
  DELETE FROM user_company_roles WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_memberships = ROW_COUNT;
  DELETE FROM company_profiles WHERE company_id = p_company_id::text;   -- company_profiles.company_id is text
  GET DIAGNOSTICS v_profiles = ROW_COUNT;
  -- 238 FKs reference companies: 224 cascade, 9 set null, 5 do not (users.active_company_id, whatsapp_*,
  -- campaign_cost_breakdown): a referencing row now aborts the WHOLE
  -- function (23503) instead of leaving the memberships/profile deleted.
  DELETE FROM companies WHERE id = p_company_id;

  RETURN QUERY SELECT v_memberships, v_profiles;
END;
$$;

REVOKE ALL ON FUNCTION public.disable_company_cascade(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disable_company_cascade(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.hard_delete_company(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_company(uuid, uuid, text) TO service_role;
-- disable_company_cascade keeps the grants applied by 20261026000000_close_anon_rls_exposure.sql
-- (CREATE OR REPLACE preserves existing privileges).

COMMIT;

-- ROLLBACK (manual; no data is migrated):
--   DROP TRIGGER IF EXISTS trg_guard_super_admin_membership_company ON public.user_company_roles;
--   DROP FUNCTION IF EXISTS public.guard_super_admin_membership_company();
--   DROP FUNCTION IF EXISTS public.hard_delete_company(uuid, uuid, text);
--   re-apply disable_company_cascade from supabase/_schema/baseline.sql (restores the race).
