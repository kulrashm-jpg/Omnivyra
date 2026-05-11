-- Human-operations readiness for invited-beta monetization drills.

CREATE TABLE IF NOT EXISTS monetization_beta_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_type text NOT NULL
    CHECK (drill_type IN (
      'successful_purchase',
      'duplicate_webhook',
      'delayed_webhook',
      'invalid_signature',
      'failed_fulfillment',
      'reconciliation_recovery',
      'freeze_mode',
      'replay_dry_run'
    )),
  status text NOT NULL
    CHECK (status IN ('planned', 'running', 'passed', 'failed', 'blocked')),
  operator_user_id uuid NOT NULL,
  organization_id uuid,
  purchase_id uuid,
  provider_event_id text,
  expected_outcome text NOT NULL,
  observed_outcome text,
  anomalies_found jsonb NOT NULL DEFAULT '[]'::jsonb,
  economic_impact_assessment text,
  follow_up_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_monetization_beta_drills_status
  ON monetization_beta_drills(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_monetization_beta_drills_refs
  ON monetization_beta_drills(organization_id, purchase_id, provider_event_id, created_at DESC);

ALTER TABLE payment_provider_events
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS correlation_id text;
