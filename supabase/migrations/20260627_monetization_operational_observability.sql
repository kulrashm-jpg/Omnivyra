-- Monetization operational observability for controlled staging rollout.

CREATE TABLE IF NOT EXISTS monetization_operational_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace text NOT NULL DEFAULT 'monetization',
  event_name text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARN', 'ERROR', 'CRITICAL')),
  organization_id uuid,
  request_id text,
  correlation_id text,
  provider text,
  provider_event_id text,
  provider_order_id text,
  provider_payment_id text,
  purchase_id uuid,
  fulfillment_status text,
  reservation_id uuid,
  alert_key text,
  alert_ready boolean NOT NULL DEFAULT false,
  customer_safe boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monetization_ops_created
  ON monetization_operational_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_monetization_ops_alerts
  ON monetization_operational_events(alert_ready, severity, created_at DESC)
  WHERE alert_ready = true;

CREATE INDEX IF NOT EXISTS idx_monetization_ops_provider_event
  ON monetization_operational_events(provider, provider_event_id, created_at DESC)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_monetization_ops_purchase
  ON monetization_operational_events(purchase_id, created_at DESC)
  WHERE purchase_id IS NOT NULL;

ALTER TABLE monetization_operational_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS monetization_operational_events_service_all ON monetization_operational_events;
CREATE POLICY monetization_operational_events_service_all ON monetization_operational_events
  FOR ALL USING (auth.role() = 'service_role');
