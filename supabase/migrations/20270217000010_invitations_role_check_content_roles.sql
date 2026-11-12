-- 20270217000010_invitations_role_check_content_roles
--
-- ROLES APPROACH A, R3 (owner ruling via e9, 2026-11-12). CONTENT_MANAGER,
-- CONTENT_PLANNER, CONTENT_ENGAGER and VIEWER are REAL tenant roles. Every
-- invite / reinvite / acceptance path now uses ONE list (rbacPrimitives
-- INVITABLE_TENANT_ROLES = COMPANY_ADMIN + NON_ADMIN_TENANT_ROLES) and no path
-- silently downgrades a role. This widens invitations_role_check to exactly that
-- list. SUPER_ADMIN is never invitable (identity.admin.assign only).
-- Before this applies, inviting one of the four fails closed (409 / 400).
--
-- C25 (83, prod read-only, 2026-11-12): invitations hold COMPANY_ADMIN only
-- (2 rows); the current CHECK is the five-role set. A WIDENING: every row that
-- passes today passes after.
-- PRECONDITION: RAISES (nothing changed) if any row is outside the new set.
-- POSTCONDITION: the constraint exists, is validated, names all nine roles and
-- never SUPER_ADMIN.
-- No table, view or function is created: no grant changes.
-- Rollback: rollbacks/invitations_role_check_content_roles_rollback.sql
-- GOV-SECURITY: virality-83; review: virality-05.

DO $pre$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.invitations
   WHERE role IS NOT NULL
     AND role NOT IN ('COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY',
                      'CONTENT_MANAGER', 'CONTENT_PLANNER', 'CONTENT_ENGAGER', 'VIEWER');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'invitations_role_check_content_roles: % invitation row(s) carry a role outside the new set - nothing changed', v_bad;
  END IF;
END
$pre$;

ALTER TABLE public.invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE public.invitations ADD CONSTRAINT invitations_role_check CHECK (
  role = ANY (ARRAY['COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY',
                    'CONTENT_MANAGER', 'CONTENT_PLANNER', 'CONTENT_ENGAGER', 'VIEWER']::text[])
);

DO $post$
DECLARE v_def text; v_valid boolean; r text;
BEGIN
  SELECT pg_get_constraintdef(c.oid), c.convalidated INTO v_def, v_valid
    FROM pg_constraint c
   WHERE c.conrelid = 'public.invitations'::regclass AND c.conname = 'invitations_role_check' AND c.contype = 'c';
  IF v_def IS NULL OR v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invitations_role_check_content_roles: postcondition failed - constraint missing or not validated';
  END IF;
  FOREACH r IN ARRAY ARRAY['COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY',
                           'CONTENT_MANAGER', 'CONTENT_PLANNER', 'CONTENT_ENGAGER', 'VIEWER'] LOOP
    IF position(quote_literal(r) IN v_def) = 0 THEN
      RAISE EXCEPTION 'invitations_role_check_content_roles: postcondition failed - % missing from %', r, v_def;
    END IF;
  END LOOP;
  IF position('SUPER_ADMIN' IN v_def) > 0 THEN
    RAISE EXCEPTION 'invitations_role_check_content_roles: postcondition failed - SUPER_ADMIN must never be invitable';
  END IF;
END
$post$;
