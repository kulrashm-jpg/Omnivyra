-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260422192904  Name: signup_referrals
-- Idempotency: GUARDED (CREATE TABLE IF NOT EXISTS, DO blocks for policies, DROP CONSTRAINT IF EXISTS).

BEGIN;

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

ALTER TABLE public.email_jobs
  DROP CONSTRAINT IF EXISTS email_jobs_job_type_check;

ALTER TABLE public.email_jobs
  ADD CONSTRAINT email_jobs_job_type_check
  CHECK (job_type = ANY (ARRAY['magic_link','invite','reset','company_referral']::text[]));

COMMIT;
