-- 20270217000012_user_company_roles_last_admin_guard
--
-- OWNER RULING (via e9, 2026-11-12): several COMPANY_ADMINs per company are
-- allowed; the LAST active COMPANY_ADMIN can be removed only if another active
-- COMPANY_ADMIN exists first. Registered BLOCKING: company/users.ts PUT/DELETE
-- (and others - e1's audit of ~25 mutation paths) can demote / deactivate /
-- delete the last admin today. This is the ATOMIC guard every path inherits.
--
-- WHAT IS REFUSED: a transaction that leaves a company - which is ACTIVE, not
-- soft-deleted, and still exists at COMMIT - with ZERO active COMPANY_ADMIN rows
-- after removing one (role changed away, status left 'active', company_id moved,
-- or the row deleted). Only that TRANSITION is refused: companies that already
-- have no admin (C19/C25: 24) are untouched unless an admin row is removed.
-- An active SUPER_ADMIN row does NOT count as the company's admin (e9 ruling,
-- option B), so assign_super_admin on a company's last COMPANY_ADMIN is refused
-- until another admin exists. Super Admin intervention may not reach zero either
-- (e9): intervention = transfer ownership (promote, then demote) or disable the
-- company.
--
-- WHAT IS ALLOWED, by POST-STATE at commit (no bypass flag anywhere):
--   * the company is no longer 'active' (disable_company_cascade / soft delete
--     flip companies.status BEFORE deactivating memberships);
--   * the company is soft-deleted (deleted_at) or GONE (hard_delete_company
--     deletes memberships, then the company row, in one function);
--   * the removed admin's USER is deleted (super-admin user deletion soft-deletes
--     users before deactivating memberships; a hard user delete cascades).
--
-- HOW (05: a row-level IMMEDIATE check cannot hold a set invariant):
--   * trg_company_admin_last_active_lock - BEFORE ROW: when OLD is an active
--     COMPANY_ADMIN, takes a per-company transaction advisory lock, so two
--     transactions removing two different admins SERIALISE. THE LOCK IS
--     LOAD-BEARING (05): without it, two transactions each demoting one of two
--     admins can both reach their commit-time checks before either commits -
--     neither sees the other, both pass, zero admins remain. "The later committer
--     re-checks anyway" holds only when the commits are far apart; the lock makes
--     the second block until the first ends. Do NOT remove it as redundant.
--   * trg_company_admin_last_active_check - a CONSTRAINT trigger, DEFERRABLE
--     INITIALLY DEFERRED: it runs at COMMIT and re-reads the post-state (READ
--     COMMITTED: a fresh snapshot per statement), so a bulk statement demoting
--     every admin is refused, a concurrent transaction that committed first is
--     seen, and multi-statement legitimate flows (hard delete) see their end.
-- "GONE" HAS ONE DEFINITION (05): a user that is is_deleted, has deleted_at, or
-- status 'deleted' (or no longer exists). It applies to BOTH halves - the removed
-- admin is exempt when gone, and a REMAINING admin counts only when NOT gone - so
-- an active row whose user is deleted can never keep a company "administered".
-- RESIDUAL (stated, not closed here): deleting / soft-deleting the last admin's
-- USER row writes nothing to user_company_roles, so this trigger does not fire.
-- User deletion is a Super-Admin-governed path (step-up, IDENTITY_ADMIN_DELETE);
-- a companion trigger on users is a separate decision.
-- BYPASS SURFACE: only ALTER TABLE ... DISABLE TRIGGER (table owner) or
-- session_replication_role = replica (superuser) skip it; neither is available
-- to service_role through the API (to be confirmed from the catalog by 83).
-- The error is P0001 'LAST_COMPANY_ADMIN' with a HINT naming the fix; routes map
-- it to 409.
--
-- PRECONDITION: the four objects are either ALL absent (fresh apply) or ALL
-- present (re-run: verified, nothing replaced). A MIXED state RAISES - it is a
-- partial earlier attempt and must be inspected, not papered over (05).
-- POSTCONDITION: both triggers exist and are enabled; the check is a deferrable,
-- initially-deferred constraint trigger; both functions are SECURITY INVOKER with
-- a pinned search_path and no EXECUTE for PUBLIC / anon / authenticated.
-- No table is created; no grant on a table changes.
-- Rollback: rollbacks/user_company_roles_last_admin_guard_rollback.sql - sound by
-- PROVENANCE: every object name originates in this (unapplied) migration.
-- GOV-SECURITY: virality-83; review: virality-05.

DO $pre$
DECLARE n int;
BEGIN
  SELECT
      (CASE WHEN to_regprocedure('public.company_admin_last_active_lock()') IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN to_regprocedure('public.company_admin_last_active_check()') IS NULL THEN 0 ELSE 1 END)
    + (SELECT count(*)::int FROM pg_trigger
        WHERE tgrelid = 'public.user_company_roles'::regclass
          AND tgname IN ('trg_company_admin_last_active_lock', 'trg_company_admin_last_active_check')
          AND NOT tgisinternal)
    INTO n;
  IF n NOT IN (0, 4) THEN
    RAISE EXCEPTION 'company_admin_last_active_guard: % of 4 objects already exist (a partial earlier attempt) - inspect them; nothing changed', n;
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.company_admin_last_active_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF OLD.role = 'COMPANY_ADMIN' AND OLD.status = 'active' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('company_admin_last_active:' || OLD.company_id::text, 0));
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.company_admin_last_active_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_status text;
  v_deleted_at timestamptz;
  v_user_gone boolean;
BEGIN
  -- Only the removal of an ACTIVE COMPANY_ADMIN can create the zero-admin state.
  IF NOT (OLD.role = 'COMPANY_ADMIN' AND OLD.status = 'active') THEN
    RETURN NULL;
  END IF;

  -- Post-state exemption 1: the company is gone, disabled or soft-deleted.
  SELECT c.status, c.deleted_at INTO v_status, v_deleted_at FROM public.companies c WHERE c.id = OLD.company_id;
  IF NOT FOUND OR v_status IS DISTINCT FROM 'active' OR v_deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- Post-state exemption 2: the removed admin's user is deleted (or gone).
  SELECT (u.is_deleted OR u.deleted_at IS NOT NULL OR u.status = 'deleted') INTO v_user_gone
    FROM public.users u WHERE u.id = OLD.user_id;
  IF NOT FOUND OR v_user_gone IS TRUE THEN
    RETURN NULL;
  END IF;

  -- The invariant: at least one active COMPANY_ADMIN remains whose USER is not
  -- gone (the SAME liveness definition as above - 05).
  IF EXISTS (
    SELECT 1 FROM public.user_company_roles r
      JOIN public.users ru ON ru.id = r.user_id
     WHERE r.company_id = OLD.company_id AND r.role = 'COMPANY_ADMIN' AND r.status = 'active'
       AND NOT (ru.is_deleted OR ru.deleted_at IS NOT NULL OR ru.status = 'deleted')
  ) THEN
    RETURN NULL;
  END IF;

  RAISE EXCEPTION 'LAST_COMPANY_ADMIN'
    USING ERRCODE = 'P0001',
          DETAIL  = format('company %s would be left with no active COMPANY_ADMIN', OLD.company_id),
          HINT    = 'Promote another member to COMPANY_ADMIN first (transfer ownership), or disable the company.';
END
$fn$;

REVOKE ALL ON FUNCTION public.company_admin_last_active_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_admin_last_active_check() FROM PUBLIC, anon, authenticated;

DO $trg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.user_company_roles'::regclass
                  AND tgname = 'trg_company_admin_last_active_lock' AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_company_admin_last_active_lock
      BEFORE UPDATE OF role, status, company_id OR DELETE ON public.user_company_roles
      FOR EACH ROW EXECUTE FUNCTION public.company_admin_last_active_lock();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.user_company_roles'::regclass
                  AND tgname = 'trg_company_admin_last_active_check' AND NOT tgisinternal) THEN
    CREATE CONSTRAINT TRIGGER trg_company_admin_last_active_check
      AFTER UPDATE OF role, status, company_id OR DELETE ON public.user_company_roles
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.company_admin_last_active_check();
  END IF;
END
$trg$;

DO $post$
DECLARE r record; fn text;
BEGIN
  SELECT t.tgenabled, t.tgdeferrable, t.tginitdeferred, (t.tgconstraint <> 0) AS is_constraint INTO r
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.user_company_roles'::regclass AND t.tgname = 'trg_company_admin_last_active_check';
  IF NOT FOUND OR r.tgenabled <> 'O' OR NOT r.tgdeferrable OR NOT r.tginitdeferred OR NOT r.is_constraint THEN
    RAISE EXCEPTION 'company_admin_last_active_guard: postcondition failed - check trigger missing, disabled, or not a deferred constraint trigger';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.user_company_roles'::regclass
                  AND t.tgname = 'trg_company_admin_last_active_lock' AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'company_admin_last_active_guard: postcondition failed - lock trigger missing or disabled';
  END IF;
  FOREACH fn IN ARRAY ARRAY['public.company_admin_last_active_lock()', 'public.company_admin_last_active_check()'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(fn)
                AND (p.prosecdef OR p.proconfig IS NULL OR NOT ('search_path=pg_catalog, public' = ANY (p.proconfig)))) THEN
      RAISE EXCEPTION 'company_admin_last_active_guard: postcondition failed - % is SECURITY DEFINER or lacks the pinned search_path', fn;
    END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'company_admin_last_active_guard: postcondition failed - a client role can EXECUTE %', fn;
    END IF;
  END LOOP;
END
$post$;
