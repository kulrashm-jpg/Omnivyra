-- Stage 31 — Governance Tamper-Evident Event Ledger
-- Cryptographically chained governance events.

ALTER TABLE campaign_governance_events
  ADD COLUMN IF NOT EXISTS event_hash TEXT,
  ADD COLUMN IF NOT EXISTS previous_event_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_governance_events_hash
  ON campaign_governance_events(event_hash);
