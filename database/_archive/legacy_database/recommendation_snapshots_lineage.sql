-- =====================================================
-- RECOMMENDATION SNAPSHOTS LINEAGE
-- Insight → Recommendation → Campaign traceability
-- source_signal_id: FK to intelligence_signals
-- source_signal_type: EXTERNAL_API | OMNIVYRA | COMMUNITY | MANUAL
-- source_topic: original normalized topic from upstream signal
-- =====================================================

ALTER TABLE recommendation_snapshots
  ADD COLUMN IF NOT EXISTS source_signal_id UUID NULL,
  ADD COLUMN IF NOT EXISTS source_signal_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS source_topic TEXT NULL;

-- Optional FK (run manually when intelligence_signals exists):
-- ALTER TABLE recommendation_snapshots DROP CONSTRAINT IF EXISTS fk_recommendation_signal;
-- ALTER TABLE recommendation_snapshots
--   ADD CONSTRAINT fk_recommendation_signal
--   FOREIGN KEY (source_signal_id) REFERENCES intelligence_signals(id) ON DELETE SET NULL;
