-- 20270217000042 - users.active_company_id is cleared when the membership it points at stops being active
-- (e1, BLOCKING tenancy; e9 ruling 2026-11-13 "the TRIGGER"; version from virality-83; review: virality-05).
--
-- WHY.
--   users.active_company_id is the user's "current company". trg_users_active_company_membership_guard (20260510)
--   refuses to SET it to a company without an ACTIVE membership - but nothing re-checks it when the MEMBERSHIP
--   later stops being active. Every deactivation (usersMutations Step D, the company-disable cascade, the governed
--   RPCs - 10 SQL writers plus the app paths) therefore minted a stale pointer: 55's sweep found 24 of 33 prod
--   pointers referencing a company where the user was not active, and D7 (a one-time data step) nulled 25.
--   This trigger makes the invariant structural for EVERY writer, present and future: when a membership leaves
--   'active' (status change, re-home of company_id / user_id, or DELETE), the user's pointer is cleared IF it
--   points at that company. A NULL pointer is safe: sync-supabase-user re-derives it from an active membership at
--   the next login, and every reader already handles "no current company".
--
-- WHAT. Schema only - NO data write at apply (D7 already cleared the existing stale pointers).
--   * public.users_clear_active_company_on_membership_exit() - SECURITY DEFINER (the writer may be a role that
--     cannot UPDATE users), search_path pinned to '' and every name schema-qualified, EXECUTE revoked from PUBLIC,
--     anon and authenticated (a trigger function is never called directly).
--   * AFTER UPDATE OF status, company_id, user_id OR DELETE ON public.user_company_roles FOR EACH ROW.
--
-- INTERPLAY (checked against baseline + migrations):
--   * trg_users_active_company_membership_guard (BEFORE UPDATE OF active_company_id ON users) returns early for a
--     NULL pointer, so the clearing UPDATE always passes it.
--   * trg_sync_company_id (BEFORE UPDATE ON users) mirrors NULL into the deprecated users.company_id - intended.
--   * update_users_updated_at (BEFORE UPDATE ON users) stamps updated_at - harmless.
--   * No trigger on users writes user_company_roles, so there is no recursion.
--   * users -> user_company_roles is ON DELETE CASCADE: deleting a user deletes its memberships; the trigger's
--     UPDATE then matches no row (the user is gone) and is a no-op.
--
-- ROLLBACK: rollbacks/users_active_company_pointer_cleared_on_membership_exit_rollback.sql (drops the trigger and
--   the function; pointers cleared meanwhile stay NULL and are re-derived at login).

-- Preflight: refuse to adopt a trigger or function of the same name that this migration did not create.
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.user_company_roles'::regclass
                AND tgname = 'user_company_roles_clear_active_company_pointer' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'preflight: trigger user_company_roles_clear_active_company_pointer already exists - refusing to adopt it';
  END IF;
  IF to_regprocedure('public.users_clear_active_company_on_membership_exit()') IS NOT NULL THEN
    RAISE EXCEPTION 'preflight: function public.users_clear_active_company_on_membership_exit() already exists - refusing to adopt it';
  END IF;
END
$preflight$;

CREATE FUNCTION public.users_clear_active_company_on_membership_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- Only a membership that WAS active can be what a valid pointer refers to.
  IF OLD.status IS DISTINCT FROM 'active' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE'
     OR NEW.status IS DISTINCT FROM 'active'
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
  THEN
    UPDATE public.users
       SET active_company_id = NULL
     WHERE id = OLD.user_id
       AND active_company_id = OLD.company_id;
  END IF;

  RETURN NULL; -- AFTER trigger: the return value is ignored
END;
$fn$;

-- Stated explicitly: 20261026000000's default privileges already drop PUBLIC and anon for postgres-owned functions,
-- but hosted Supabase's own defaults GRANT EXECUTE to authenticated - without this REVOKE the postcondition fails
-- there (proven: the mutant with a hosted-style GRANT to authenticated and no REVOKE is refused by $verify$).
REVOKE ALL ON FUNCTION public.users_clear_active_company_on_membership_exit() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER user_company_roles_clear_active_company_pointer
AFTER UPDATE OF status, company_id, user_id OR DELETE ON public.user_company_roles
FOR EACH ROW
EXECUTE FUNCTION public.users_clear_active_company_on_membership_exit();

COMMENT ON FUNCTION public.users_clear_active_company_on_membership_exit() IS
  'Clears users.active_company_id when the ACTIVE membership it points at is deactivated, re-homed or deleted (e1, e9 ruling 2026-11-13). Trigger function only.';

-- Postcondition: exactly what this migration promises, measured.
DO $verify$
DECLARE
  v_enabled "char";
  v_secdef boolean;
  v_config text[];
BEGIN
  SELECT t.tgenabled INTO v_enabled FROM pg_trigger t
   WHERE t.tgrelid = 'public.user_company_roles'::regclass
     AND t.tgname = 'user_company_roles_clear_active_company_pointer' AND NOT t.tgisinternal;
  IF v_enabled IS NULL THEN
    RAISE EXCEPTION 'postcondition: trigger user_company_roles_clear_active_company_pointer missing';
  END IF;
  IF v_enabled = 'D' THEN
    RAISE EXCEPTION 'postcondition: trigger user_company_roles_clear_active_company_pointer is disabled';
  END IF;
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config FROM pg_proc p
   WHERE p.oid = 'public.users_clear_active_company_on_membership_exit()'::regprocedure;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'postcondition: users_clear_active_company_on_membership_exit must be SECURITY DEFINER';
  END IF;
  IF v_config IS NULL OR NOT ('search_path=""' = ANY (v_config)) THEN
    RAISE EXCEPTION 'postcondition: users_clear_active_company_on_membership_exit must pin search_path to empty (got %)', v_config;
  END IF;
  -- proacl IS NULL means the DEFAULT (PUBLIC may EXECUTE) for a function - so it must be non-NULL and closed.
  IF (SELECT proacl FROM pg_proc WHERE oid = 'public.users_clear_active_company_on_membership_exit()'::regprocedure) IS NULL THEN
    RAISE EXCEPTION 'postcondition: users_clear_active_company_on_membership_exit proacl is NULL (default PUBLIC EXECUTE)';
  END IF;
  IF has_function_privilege('anon', 'public.users_clear_active_company_on_membership_exit()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.users_clear_active_company_on_membership_exit()', 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition: a client role may EXECUTE users_clear_active_company_on_membership_exit';
  END IF;
END
$verify$;
