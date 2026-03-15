-- intelligence_alerts
-- Stores in-app alerts from Intelligence Alert System
-- Used when sendIntelligenceAlert sends to 'in_app' channel

CREATE TABLE IF NOT EXISTS intelligence_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  rule_types TEXT[] DEFAULT '{}',
  title TEXT NOT NULL DEFAULT 'Intelligence Alert',
  message TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  channels TEXT[] DEFAULT '{in_app}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intelligence_alerts_company
  ON intelligence_alerts (company_id);

CREATE INDEX IF NOT EXISTS idx_intelligence_alerts_company_created
  ON intelligence_alerts (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_alerts_unread
  ON intelligence_alerts (company_id, read_at) WHERE read_at IS NULL;

COMMENT ON TABLE intelligence_alerts IS 'In-app alerts from intelligence event rules: opportunity_score>85, trend_strength>threshold, health_score<50';

ALTER TABLE intelligence_alerts
  ADD COLUMN IF NOT EXISTS alert_rule_key TEXT;

CREATE INDEX IF NOT EXISTS idx_intelligence_alerts_rule_key_created
  ON intelligence_alerts (alert_rule_key, created_at DESC) WHERE alert_rule_key IS NOT NULL;
