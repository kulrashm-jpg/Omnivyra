-- External-beta operational trust hardening for monetization.
-- Adds support/alert classification fields without changing payment semantics.

ALTER TABLE monetization_operational_events
  ADD COLUMN IF NOT EXISTS escalation_priority text NOT NULL DEFAULT 'informational'
    CHECK (escalation_priority IN ('informational', 'support_review', 'urgent', 'critical')),
  ADD COLUMN IF NOT EXISTS requires_human_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_impact text NOT NULL DEFAULT 'none'
    CHECK (customer_impact IN ('none', 'possible', 'confirmed')),
  ADD COLUMN IF NOT EXISTS economic_risk text NOT NULL DEFAULT 'none'
    CHECK (economic_risk IN ('none', 'low', 'medium', 'high', 'critical'));

CREATE INDEX IF NOT EXISTS idx_monetization_ops_human_review
  ON monetization_operational_events(requires_human_review, escalation_priority, created_at DESC)
  WHERE requires_human_review = true;

CREATE INDEX IF NOT EXISTS idx_monetization_ops_customer_impact
  ON monetization_operational_events(customer_impact, economic_risk, created_at DESC)
  WHERE customer_impact <> 'none' OR economic_risk <> 'none';
