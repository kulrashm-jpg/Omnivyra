-- =====================================================
-- OPPORTUNITY LEARNING METRICS EXTENSIONS
-- Adds average_confidence_score, average_time_to_campaign, average_time_to_completion
-- Run after: opportunity_learning_metrics.sql
-- =====================================================

ALTER TABLE opportunity_learning_metrics ADD COLUMN IF NOT EXISTS average_confidence_score NUMERIC;
ALTER TABLE opportunity_learning_metrics ADD COLUMN IF NOT EXISTS average_time_to_campaign_hours NUMERIC;
ALTER TABLE opportunity_learning_metrics ADD COLUMN IF NOT EXISTS average_time_to_completion_hours NUMERIC;
