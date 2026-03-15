-- Signal lifecycle (signal_status) and archive table for retention.
-- Run after campaign_activity_engagement_signals.sql.

-- Add signal_status column
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'campaign_activity_engagement_signals' AND column_name = 'signal_status') THEN
    ALTER TABLE campaign_activity_engagement_signals ADD COLUMN signal_status TEXT DEFAULT 'new' CHECK (signal_status IN ('new', 'reviewed', 'actioned', 'ignored'));
    RAISE NOTICE 'Added campaign_activity_engagement_signals.signal_status';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campaign_activity_signals_status
  ON campaign_activity_engagement_signals(signal_status) WHERE signal_status IS NOT NULL;

-- Archive table (structure mirrors main table)
CREATE TABLE IF NOT EXISTS campaign_activity_engagement_signals_archive (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL,
  activity_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  conversation_url TEXT,
  author TEXT,
  content TEXT,
  signal_type TEXT NOT NULL,
  engagement_score NUMERIC NOT NULL DEFAULT 0,
  signal_status TEXT DEFAULT 'new',
  detected_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  organization_id UUID,
  raw_payload JSONB,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signals_archive_detected
  ON campaign_activity_engagement_signals_archive(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_archive_campaign
  ON campaign_activity_engagement_signals_archive(campaign_id);
