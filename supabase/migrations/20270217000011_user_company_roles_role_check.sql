-- 20270217000011_user_company_roles_role_check
--
-- ROLES APPROACH A, R3 (owner ruling via e9, 2026-11-12). user_company_roles.role
-- had NO CHECK, so any string could be stored; a misspelt or legacy value then
-- authorised as nothing (CapabilityService) or was rewritten (normalizeRole).
-- This pins the column to the canonical Role values (rbacPrimitives.Role minus
-- the ADMIN alias): SUPER_ADMIN, COMPANY_ADMIN and the eight non-admin tenant
-- roles. NOT NULL is ASSERTED too (05): a CHECK alone is SATISFIED by NULL
-- (role IN (...) yields NULL, and a CHECK rejects only FALSE). In prod the
-- column is ALREADY `role text NOT NULL` (baseline.sql), so SET NOT NULL is a
-- no-op there; it makes the guarantee explicit and holds in any environment
-- whose table lacks it (it takes ACCESS EXCLUSIVE and scans - trivial here).
-- The rollback leaves NOT NULL in place (this migration never added it in prod).
--
-- Data step D1 (83, owner-approved, 2026-11-12) renamed the 22 legacy
-- lowercase 'admin' rows to COMPANY_ADMIN. C25 after D1: COMPANY_ADMIN (9
-- active, 24 inactive), SUPER_ADMIN (1 active), nothing else.
-- PRECONDITION: RAISES (nothing changed) with the count of rows outside the set,
-- and with the count of NULL roles.
-- Re-run: if the constraint already exists it is VERIFIED (never silently
-- replaced); a different definition fails the postcondition.
-- POSTCONDITION: exists, validated, names all ten roles, does not name ADMIN;
-- role is NOT NULL.
-- No grant changes. Rollback: rollbacks/user_company_roles_role_check_rollback.sql
-- GOV-SECURITY: virality-83; review: virality-05.

DO $mig$
DECLARE
  v_bad int;
  v_def text;
  v_roles text[] := ARRAY['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER',
                          'VIEW_ONLY', 'CONTENT_MANAGER', 'CONTENT_PLANNER', 'CONTENT_ENGAGER', 'VIEWER'];
  r text;
BEGIN
  SELECT count(*) INTO v_bad FROM public.user_company_roles
   WHERE role IS NOT NULL AND NOT (role = ANY (v_roles));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'user_company_roles_role_check: % membership row(s) carry a role outside the canonical set - normalise them first; nothing changed', v_bad;
  END IF;
  SELECT count(*) INTO v_bad FROM public.user_company_roles WHERE role IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'user_company_roles_role_check: % membership row(s) have a NULL role - resolve them first; nothing changed', v_bad;
  END IF;

  ALTER TABLE public.user_company_roles ALTER COLUMN role SET NOT NULL;

  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.user_company_roles'::regclass AND c.conname = 'user_company_roles_role_check';

  IF v_def IS NULL THEN
    ALTER TABLE public.user_company_roles ADD CONSTRAINT user_company_roles_role_check CHECK (
      role = ANY (ARRAY['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER',
                        'VIEW_ONLY', 'CONTENT_MANAGER', 'CONTENT_PLANNER', 'CONTENT_ENGAGER', 'VIEWER']::text[])
    );
  ELSE
    RAISE NOTICE 'user_company_roles_role_check: constraint exists - verifying its definition (no change)';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.user_company_roles'::regclass AND c.conname = 'user_company_roles_role_check'
     AND c.contype = 'c' AND c.convalidated;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'user_company_roles_role_check: postcondition failed - constraint missing or not validated';
  END IF;
  FOREACH r IN ARRAY v_roles LOOP
    IF position(quote_literal(r) IN v_def) = 0 THEN
      RAISE EXCEPTION 'user_company_roles_role_check: postcondition failed - % missing from %', r, v_def;
    END IF;
  END LOOP;
  IF position(quote_literal('ADMIN') IN v_def) > 0 THEN
    RAISE EXCEPTION 'user_company_roles_role_check: postcondition failed - the legacy ADMIN alias must not be allowed (%)', v_def;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.user_company_roles'::regclass AND attname = 'role' AND attnotnull
  ) THEN
    RAISE EXCEPTION 'user_company_roles_role_check: postcondition failed - role is not NOT NULL';
  END IF;
END
$mig$;
