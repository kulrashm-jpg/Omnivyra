-- Add report_json to persist full CampaignHealthReport (low_confidence_activities, score_breakdown, health_flags, activity_diagnostics, etc.)
-- Used by GET /api/campaigns/[id]/health for UI consumption

ALTER TABLE campaign_health_reports
ADD COLUMN IF NOT EXISTS report_json JSONB;

ALTER TABLE campaign_health_reports
ADD COLUMN IF NOT EXISTS campaign_version_id UUID;

ALTER TABLE campaign_health_reports
ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE campaign_health_reports
ADD COLUMN IF NOT EXISTS health_score INTEGER;

ALTER TABLE campaign_health_reports
ADD COLUMN IF NOT EXISTS health_status TEXT;

ALTER TABLE campaign_health_reports
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE campaign_health_reports
ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_campaign_health_reports_campaign_id
ON campaign_health_reports (campaign_id);

CREATE INDEX IF NOT EXISTS idx_campaign_health_reports_campaign_version
ON campaign_health_reports (campaign_id, campaign_version_id);

CREATE INDEX IF NOT EXISTS idx_campaign_health_reports_created_at
ON campaign_health_reports (campaign_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_health_version_unique'
  ) THEN
    ALTER TABLE campaign_health_reports
    ADD CONSTRAINT campaign_health_version_unique
    UNIQUE (campaign_id, campaign_version_id);
  END IF;
END $$;
