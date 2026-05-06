-- Identity health metrics view — read-only observability for the identity spine.
-- Already applied to prod via mcp__supabase__apply_migration; this file lets
-- a fresh environment reach the same state via `supabase db push`.
--
-- Usage: SELECT * FROM identity_health_metrics;

CREATE OR REPLACE VIEW identity_health_metrics AS
SELECT
  (SELECT COUNT(*) FROM unified_persons) AS total_persons,
  (SELECT COUNT(*) FROM leads WHERE unified_person_id IS NULL) AS leads_without_identity,
  (SELECT COUNT(*) FROM engagement_threads WHERE unified_person_id IS NOT NULL) AS linked_threads,
  (SELECT COUNT(*) FROM engagement_threads) AS total_threads,
  ROUND(
    100.0 *
    (SELECT COUNT(*) FROM engagement_threads WHERE unified_person_id IS NOT NULL) /
    NULLIF((SELECT COUNT(*) FROM engagement_threads), 0),
    2
  ) AS engagement_coverage_percent;
