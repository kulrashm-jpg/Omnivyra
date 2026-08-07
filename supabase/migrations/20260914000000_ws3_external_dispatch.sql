-- WS-3 Milestone-5B — external channel dispatch (ADDITIVE ONLY).
--
-- Delivery evidence gains the two provider fields an external send must record
-- and an internal one never had: WHICH provider accepted it, and the identifier
-- that provider issued. Without the provider message id there is no way to
-- correlate our record with the provider's, which is the first thing anyone
-- asks during a deliverability incident.
--
-- Nullable on purpose: internal dispatch has no provider, and existing rows
-- (all internal) keep their history unchanged.
--
-- Modifies NOTHING else. ADD COLUMN is DDL, not a row mutation, so it does not
-- conflict with the append-only guarantee on outreach_delivery_evidence.

ALTER TABLE outreach_delivery_evidence ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE outreach_delivery_evidence ADD COLUMN IF NOT EXISTS provider_message_id text;

-- Correlating our evidence with a provider's identifier is the hot lookup
-- during a deliverability investigation.
CREATE INDEX IF NOT EXISTS idx_outreach_delivery_provider_message
  ON outreach_delivery_evidence (company_id, provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- The deterministic provider idempotency key is recorded on the ATTEMPT, since
-- one attempt maps to exactly one provider request. Unique per tenant so a
-- repeated dispatch cannot produce a second provider request under a key the
-- provider has already seen.
ALTER TABLE outreach_attempts ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_attempts_idempotency
  ON outreach_attempts (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
