-- Invited external beta controls for sandbox/test-money monetization.

CREATE TABLE IF NOT EXISTS monetization_beta_orgs (
  organization_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  beta_cohort text NOT NULL DEFAULT 'invited-external-beta',
  invited_by uuid,
  invited_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  notes text
);

CREATE TABLE IF NOT EXISTS monetization_beta_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  beta_cohort text NOT NULL DEFAULT 'invited-external-beta',
  invited_by uuid,
  invited_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  notes text,
  UNIQUE (user_id, organization_id)
);

CREATE TABLE IF NOT EXISTS monetization_beta_support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'resolved', 'customer-contact-required')),
  organization_id uuid,
  purchase_id uuid,
  reservation_id uuid,
  provider_event_id text,
  opened_by uuid,
  latest_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_monetization_beta_support_cases_status
  ON monetization_beta_support_cases(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_monetization_beta_support_cases_org
  ON monetization_beta_support_cases(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS monetization_beta_support_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  support_case_id uuid REFERENCES monetization_beta_support_cases(id),
  action text NOT NULL
    CHECK (action IN ('replay_fulfillment', 'reconcile_reservation', 'mark_reviewed', 'escalate', 'quarantine_review')),
  actor_user_id uuid NOT NULL,
  organization_id uuid,
  purchase_id uuid,
  reservation_id uuid,
  provider_event_id text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monetization_beta_support_actions_case
  ON monetization_beta_support_actions(support_case_id, created_at DESC);

ALTER TABLE monetization_operational_events
  ADD COLUMN IF NOT EXISTS beta_cohort text,
  ADD COLUMN IF NOT EXISTS beta_access_level text,
  ADD COLUMN IF NOT EXISTS monetization_beta_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_monetization_ops_beta_cohort
  ON monetization_operational_events(beta_cohort, created_at DESC)
  WHERE beta_cohort IS NOT NULL;

ALTER TABLE payment_provider_events
  ADD COLUMN IF NOT EXISTS beta_cohort text,
  ADD COLUMN IF NOT EXISTS beta_access_level text,
  ADD COLUMN IF NOT EXISTS monetization_beta_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE credit_purchases
  ADD COLUMN IF NOT EXISTS beta_cohort text,
  ADD COLUMN IF NOT EXISTS beta_access_level text,
  ADD COLUMN IF NOT EXISTS monetization_beta_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS beta_cohort text,
  ADD COLUMN IF NOT EXISTS monetization_beta_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_credit_purchases_beta_unresolved
  ON credit_purchases(beta_cohort, fulfillment_status, created_at DESC)
  WHERE monetization_beta_enabled = true;
