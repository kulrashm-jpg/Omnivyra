-- =============================================================================
-- email_jobs — align CHECK constraints with current app code
--
-- The app writes job_type values 'company_referral' and 'inbound_signup_notice'
-- and status values 'processing' and 'dead' that the original constraints
-- (migration 20260420_hardening_auth_email_invites.sql) reject. This migration
-- drops the legacy CHECKs and adds the full union the code uses today.
-- =============================================================================

-- Fix job_type constraint
ALTER TABLE email_jobs DROP CONSTRAINT IF EXISTS email_jobs_job_type_check;

ALTER TABLE email_jobs
  ADD CONSTRAINT email_jobs_job_type_check
  CHECK (job_type IN (
    'magic_link',
    'invite',
    'reset',
    'company_referral',
    'inbound_signup_notice'
  ));

-- Fix status constraint
ALTER TABLE email_jobs DROP CONSTRAINT IF EXISTS email_jobs_status_check;

ALTER TABLE email_jobs
  ADD CONSTRAINT email_jobs_status_check
  CHECK (status IN (
    'pending',
    'processing',
    'sent',
    'failed',
    'dead'
  ));
