-- WS-3 Milestone-7 — feedback ingestion (ADDITIVE ONLY).
--
-- Extends the EXISTING two-axis outcome model rather than replacing it:
--
--   • `unsubscribed` and `converted` join the business outcome vocabulary.
--     `unsubscribed` is deliberately distinct from `rejected` — a rejection is
--     "not interested in this", an unsubscribe is "never contact me again",
--     and only the second is a compliance obligation that must feed the
--     suppression list. Collapsing them would lose the difference at exactly
--     the moment it matters legally.
--
--   • `delivered` and `bounced` are NOT added here. They already exist on the
--     DELIVERY axis, where they belong: they describe the message's fate, not
--     the recipient's behaviour. Feedback ingestion routes them to delivery
--     evidence rather than duplicating them as business outcomes.
--
--   • Provenance columns record WHERE a feedback record came from. Without
--     them, a webhook, a manual import and a derived assertion are
--     indistinguishable — and only one of those is evidence.
--
-- The append-only trigger, RLS policy, foreign key and idempotency index are
-- untouched. ADD COLUMN is DDL, not a row mutation.

-- ── extend the business outcome vocabulary ──────────────────────────────────

ALTER TABLE outreach_outcomes DROP CONSTRAINT IF EXISTS outreach_outcomes_type_valid;

ALTER TABLE outreach_outcomes ADD CONSTRAINT outreach_outcomes_type_valid CHECK (
  outcome_type IN (
    'opened', 'clicked', 'replied', 'meeting_booked',
    'rejected', 'no_response',
    -- WS-3 M7
    'unsubscribed', 'converted'
  )
);

-- ── provenance ──────────────────────────────────────────────────────────────

-- Where this record came from. `derived` (already present) says whether it was
-- observed or asserted by a rule; `source` says who observed it.
ALTER TABLE outreach_outcomes ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE outreach_outcomes ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE outreach_outcomes ADD COLUMN IF NOT EXISTS provider_event_id text;
ALTER TABLE outreach_outcomes ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  ALTER TABLE outreach_outcomes ADD CONSTRAINT outreach_outcomes_source_valid CHECK (
    source IS NULL OR source IN ('provider_webhook', 'provider_poll', 'manual', 'import', 'derived', 'internal')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── provider-event idempotency ──────────────────────────────────────────────
--
-- The existing (company, task, type, occurred_at) key collapses duplicate
-- LOGICAL outcomes. This second key collapses duplicate PROVIDER DELIVERIES:
-- a webhook retried three times carries one provider event id but may arrive
-- with a re-stamped timestamp, which the first key would not catch.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_outcomes_provider_event
  ON outreach_outcomes (company_id, provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outreach_outcomes_company_type
  ON outreach_outcomes (company_id, outcome_type, occurred_at DESC);

-- ── the delivery axis needs the same protection ─────────────────────────────
--
-- `delivered` and `bounced` arrive by the same at-least-once webhook as the
-- business outcomes, so the delivery axis needs the same two idempotency keys.
-- Without them, an ingestion layer that correctly deduplicates `replied` would
-- still record `delivered` three times for one message.

ALTER TABLE outreach_delivery_evidence ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE outreach_delivery_evidence ADD COLUMN IF NOT EXISTS provider_event_id text;

DO $$ BEGIN
  ALTER TABLE outreach_delivery_evidence ADD CONSTRAINT outreach_delivery_source_valid CHECK (
    source IS NULL OR source IN ('provider_webhook', 'provider_poll', 'manual', 'import', 'derived', 'internal')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_delivery_provider_event
  ON outreach_delivery_evidence (company_id, provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

-- Logical duplicate key. A second row with the same task, status and instant is
-- by definition the same observation reported twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_delivery_logical
  ON outreach_delivery_evidence (company_id, task_id, delivery_status, observed_at);
