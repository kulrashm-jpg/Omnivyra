-- Extend campaign_performance_signals with optional fields for Campaign Learning Layer
-- Run in Supabase SQL Editor. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'campaign_performance_signals' AND column_name = 'week_number') THEN
    ALTER TABLE campaign_performance_signals ADD COLUMN week_number INTEGER;
    RAISE NOTICE 'Added campaign_performance_signals.week_number';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'campaign_performance_signals' AND column_name = 'theme_index') THEN
    ALTER TABLE campaign_performance_signals ADD COLUMN theme_index INTEGER;
    RAISE NOTICE 'Added campaign_performance_signals.theme_index';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'campaign_performance_signals' AND column_name = 'content_slot_id') THEN
    ALTER TABLE campaign_performance_signals ADD COLUMN content_slot_id TEXT;
    RAISE NOTICE 'Added campaign_performance_signals.content_slot_id';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campaign_performance_signals_week
  ON campaign_performance_signals(campaign_id, week_number) WHERE week_number IS NOT NULL;
