-- ============================================================================
-- One-time reconciliation: public.users.has_password drift
-- ============================================================================
-- Context: pages/api/auth/login.ts uses public.users.has_password to decide
-- whether to route a user to password login or to NO_PASSWORD (magic link).
-- That flag has drifted `true` for accounts that have NO real Supabase
-- email/password identity (legacy / admin-created / migrated / test rows),
-- producing a generic "Incorrect email or password" dead-end.
--
-- Source of truth for "has a password" = an `email` provider row in
-- auth.identities for the user's auth.users id.
--
-- RUN IN: Supabase SQL Editor (needs access to the `auth` schema).
-- The login.ts hardening already fixes runtime behavior for supabase_uid-
-- linked rows; this reconciliation makes the stored flag truthful too and
-- also covers null-supabase_uid rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1 — READ-ONLY AUDIT. Run this first. Review the rows + count.
-- ----------------------------------------------------------------------------
SELECT
  u.id,
  u.email,
  u.supabase_uid,
  CASE
    WHEN u.supabase_uid IS NULL                              THEN 'null_supabase_uid'
    WHEN au.id IS NULL                                       THEN 'auth_user_missing'
    ELSE                                                          'no_email_identity'
  END AS reason
FROM public.users u
LEFT JOIN auth.users au
  ON au.id = u.supabase_uid::uuid
WHERE u.has_password = true
  AND NOT EXISTS (
    SELECT 1
    FROM auth.identities i
    WHERE i.user_id = u.supabase_uid::uuid
      AND i.provider = 'email'
  )
ORDER BY u.email;

-- Count only:
-- SELECT count(*) FROM public.users u
-- WHERE u.has_password = true
--   AND NOT EXISTS (SELECT 1 FROM auth.identities i
--                   WHERE i.user_id = u.supabase_uid::uuid AND i.provider = 'email');


-- ----------------------------------------------------------------------------
-- STEP 2 — RECONCILIATION. Run ONLY after reviewing Step 1 output.
-- Transactional: inspect the returned rowcount, then COMMIT or ROLLBACK.
-- Sets has_password=false ONLY for rows with no real email/password identity.
-- It never touches identities, sessions, or users that DO have a password.
-- Fully reversible (set the flag back to true).
-- ----------------------------------------------------------------------------
BEGIN;

UPDATE public.users u
SET has_password = false
WHERE u.has_password = true
  AND NOT EXISTS (
    SELECT 1
    FROM auth.identities i
    WHERE i.user_id = u.supabase_uid::uuid
      AND i.provider = 'email'
  );

-- Verify: expected count should match Step 1. If correct -> COMMIT; else ROLLBACK.
-- SELECT count(*) FROM public.users WHERE has_password = false;

COMMIT;
-- ROLLBACK;  -- use this instead of COMMIT if the rowcount looks wrong
