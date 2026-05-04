-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260501113406  Name: domain_reminders_table
-- Idempotency: GUARDED.

-- Durable replacement for the previous in-process setTimeout-based reminder.
-- Each row is a single scheduled reminder. The /api/internal/process-reminders
-- endpoint (cron-driven, every 5 min) drains rows whose scheduled_at has passed,
-- skips already-verified domains, sends the email, and marks sent=true.

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

-- Processor query: WHERE sent = false AND scheduled_at <= now()
-- Partial index makes the unsent slice efficient.
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
