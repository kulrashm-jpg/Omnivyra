-- =============================================================================
-- Signup domain-claimed referral tracking.
--
-- When a new user tries to self-signup for an email domain that already has
-- an active COMPANY_ADMIN, /api/auth/signup:
--   1. Returns COMPANY_CLAIMED so the UI redirects them to /login.
--   2. Upserts a row here so we can (a) dedupe the notification email
--      (we only send once per requester email) and (b) show a different
--      message on repeat attempts ("details already shared; contact support").
--
-- Also includes a narrow SECURITY DEFINER helper so /api/auth/signup can
-- cheaply check whether auth.users already has this email confirmed,
-- without exposing the whole auth schema. Same pattern as the existing
-- auth_user_has_password function.
-- =============================================================================

BEGIN;

-- ── 1. signup_referrals ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.signup_referrals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  domain              text NOT NULL,
  company_id          uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  admin_user_id       uuid REFERENCES public.users(id)     ON DELETE SET NULL,
  admin_email_sent_at timestamptz,
  first_attempt_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_attempt_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
  attempt_count       integer NOT NULL DEFAULT 1,
  CONSTRAINT signup_referrals_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_signup_referrals_domain
  ON public.signup_referrals (domain);

ALTER TABLE public.signup_referrals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'signup_referrals'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.signup_referrals
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

COMMENT ON TABLE public.signup_referrals IS
  'Records self-signup attempts blocked by the one-admin-per-domain rule. '
  'Driver for the admin-referral email (sent once per requester email) and '
  'for the repeat-attempt UX.';

-- ── 2. auth_user_confirmed(email) helper ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_user_confirmed(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (SELECT email_confirmed_at IS NOT NULL
     FROM auth.users
     WHERE lower(email) = lower(p_email)
     LIMIT 1),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.auth_user_confirmed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_confirmed(text) TO service_role;

COMMENT ON FUNCTION public.auth_user_confirmed(text) IS
  'Returns true iff auth.users has a confirmed row for this email. Used by '
  '/api/auth/signup to short-circuit when Supabase would otherwise silently '
  'treat the call as user_repeated_signup.';

-- ── 3. Extend email_jobs.job_type to allow company_referral ────────────────
ALTER TABLE public.email_jobs
  DROP CONSTRAINT IF EXISTS email_jobs_job_type_check;

ALTER TABLE public.email_jobs
  ADD CONSTRAINT email_jobs_job_type_check
  CHECK (job_type = ANY (ARRAY['magic_link','invite','reset','company_referral']::text[]));

COMMIT;
