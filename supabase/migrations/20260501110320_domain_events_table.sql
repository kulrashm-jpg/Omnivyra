-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260501110320  Name: domain_events_table
-- Idempotency: GUARDED.

-- Lightweight analytics for domain-related events.
--
-- Pure observational table — no foreign keys, no NOT NULLs beyond id +
-- event_type so the logger can never lose an event due to a missing
-- relation (e.g., events that fire BEFORE a company is created).
--
-- Reads: backend/services/domainAnalyticsService aggregates by event_type,
-- company_id, and time window.

CREATE TABLE IF NOT EXISTS domain_events (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT         NOT NULL,
  company_id   UUID         NULL,
  final_domain TEXT         NULL,
  user_id      UUID         NULL,
  metadata     JSONB        NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_events_event_type
  ON domain_events (event_type);

CREATE INDEX IF NOT EXISTS idx_domain_events_company_id
  ON domain_events (company_id)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_domain_events_created_at
  ON domain_events (created_at DESC);

ALTER TABLE domain_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON domain_events;
CREATE POLICY "service_role_full_access" ON domain_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE domain_events IS
  'Observational event log for the canonical-domain + verification system. '
  'Written via domainEventLogger.logDomainEvent (fire-and-forget). '
  'Never write directly — failures must not block primary flows.';
