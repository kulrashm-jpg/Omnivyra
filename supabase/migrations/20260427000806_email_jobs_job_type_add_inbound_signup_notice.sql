-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260427000806  Name: email_jobs_job_type_add_inbound_signup_notice
-- Idempotency: GUARDED (DROP CONSTRAINT IF EXISTS).

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
