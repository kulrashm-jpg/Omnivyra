CREATE TABLE IF NOT EXISTS lead_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  thread_id UUID NULL REFERENCES engagement_threads(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  platform_user_id TEXT NULL,
  content_text TEXT,
  intent_score NUMERIC,
  urgency_score NUMERIC,
  icp_score NUMERIC,
  confidence_score NUMERIC,
  total_score NUMERIC,
  detected_at TIMESTAMPTZ NOT NULL,
  contact_key TEXT NULL,
  crm_lead_id TEXT NULL,
  migration_source TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lead_signals_source_type_check CHECK (source_type IN ('engagement', 'listening')),
  CONSTRAINT lead_signals_source_unique UNIQUE (organization_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_signals_org_detected_at
  ON lead_signals (organization_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_signals_org_source_score
  ON lead_signals (organization_id, source_type, total_score DESC);

CREATE INDEX IF NOT EXISTS idx_lead_signals_thread
  ON lead_signals (thread_id)
  WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_signals_platform_user
  ON lead_signals (platform, platform_user_id)
  WHERE platform_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_lead_signals_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lead_signals_set_updated_at ON lead_signals;
CREATE TRIGGER lead_signals_set_updated_at
  BEFORE UPDATE ON lead_signals
  FOR EACH ROW EXECUTE FUNCTION trg_lead_signals_set_updated_at();
