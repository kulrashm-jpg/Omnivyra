-- Durable scheduled-reminder queue for domain verification.
--
-- Replaces the prior in-process setTimeout reminder mechanism that lost
-- timers on Node process recycle. /api/internal/process-reminders drains
-- this table every 5 minutes (Vercel cron); each row records a single
-- email's intent, marked sent=true after delivery (or skip).
--
-- Applied to live DB via mcp__supabase__apply_migration on 2026-05-01.

BEGIN;

CREATE TABLE IF NOT EXISTS domain_reminders (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NULL,
  company_id    UUID         NULL,
  final_domain  TEXT         NULL,
  reminder_type TEXT         NOT NULL,
  scheduled_at  TIMESTAMPTZ  NOT NULL,
  sent          BOOLEAN      NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_reminders_unsent_due
  ON domain_reminders (scheduled_at)
  WHERE sent = false;

CREATE INDEX IF NOT EXISTS idx_domain_reminders_user_company
  ON domain_reminders (user_id, company_id);

ALTER TABLE domain_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON domain_reminders;
CREATE POLICY "service_role_full_access" ON domain_reminders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE domain_reminders IS
  'Durable scheduled reminder queue. Inserted on DOMAIN_VERIFICATION_SKIPPED. '
  'Drained by /api/internal/process-reminders (cron 5m). No external queue.';

COMMIT;
