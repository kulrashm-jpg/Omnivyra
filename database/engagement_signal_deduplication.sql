-- Signal deduplication: unique index on (platform, source_id) for campaign_activity_engagement_signals.
-- Run after campaign_activity_engagement_signals.sql.
-- Collectors use insert_engagement_signals_avoid_dupes() for ON CONFLICT DO NOTHING.

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_signal_platform_source
  ON campaign_activity_engagement_signals(platform, source_id)
  WHERE source_id IS NOT NULL AND source_id != '';

-- RPC for insert with deduplication (optional; collectors can catch 23505 instead)
CREATE OR REPLACE FUNCTION insert_engagement_signals_avoid_dupes(signals jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
  inserted integer := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_to_recordset(signals) AS x(
    campaign_id uuid,
    activity_id text,
    platform text,
    source_type text,
    source_id text,
    conversation_url text,
    author text,
    content text,
    signal_type text,
    engagement_score numeric,
    organization_id uuid
  )
  LOOP
    INSERT INTO campaign_activity_engagement_signals (
      campaign_id, activity_id, platform, source_type, source_id,
      conversation_url, author, content, signal_type, engagement_score, organization_id
    ) VALUES (
      r.campaign_id, r.activity_id, r.platform, r.source_type, r.source_id,
      r.conversation_url, r.author, r.content, r.signal_type, r.engagement_score, r.organization_id
    )
    ON CONFLICT (platform, source_id) DO NOTHING;
    inserted := inserted + 1;
  END LOOP;
  RETURN inserted;
END;
$$;
