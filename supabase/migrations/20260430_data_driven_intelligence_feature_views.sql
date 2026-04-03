BEGIN;

CREATE OR REPLACE VIEW omnivyra_decision_feature_base_view
WITH (security_invoker = on) AS
SELECT
  d.id,
  d.company_id,
  d.report_tier,
  d.source_service,
  d.entity_type,
  d.entity_id,
  CASE
    WHEN d.issue_type IN ('engagement_drop', 'engagement_dropoff', 'low_quality_traffic', 'wrong_geo_traffic', 'channel_mismatch', 'high_dropoff_page', 'weak_conversion_path', 'dead_end_pages') THEN 'engagement_drop'
    WHEN d.issue_type IN ('seo_gap', 'impression_click_gap', 'ranking_opportunity', 'keyword_decay') THEN 'seo_gap'
    WHEN d.issue_type IN ('content_gap', 'content_velocity_gap', 'content_message_mismatch', 'content_opportunity', 'topic_gap', 'weak_content_depth', 'missing_cluster_support') THEN 'content_gap'
    WHEN d.issue_type IN ('market_trend_gap', 'trend_drift') THEN 'market_shift'
    WHEN d.issue_type IN ('market_opportunity', 'strategic_market_opportunity') THEN 'market_opportunity'
    ELSE d.issue_type
  END AS canonical_issue_type,
  d.issue_type AS source_issue_type,
  d.title,
  d.description,
  d.evidence,
  d.impact_traffic,
  d.impact_conversion,
  d.impact_revenue,
  d.priority_score,
  d.effort_score,
  d.execution_score,
  d.confidence_score,
  d.recommendation,
  d.action_type,
  d.action_payload,
  d.status,
  d.last_changed_by,
  d.created_at,
  d.updated_at,
  d.resolved_at,
  d.ignored_at
FROM decision_objects d;

COMMIT;
