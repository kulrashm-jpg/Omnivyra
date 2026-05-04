BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'decision_objects'
  ) THEN
    RAISE EXCEPTION 'Missing prerequisite table "decision_objects". Run canonical decision migrations before 20260414_native_feature_issue_views.sql.';
  END IF;
END $$;

CREATE OR REPLACE VIEW omnivyra_decision_feature_base_view
WITH (security_invoker = on) AS
SELECT
  d.id,
  d.company_id,
  d.report_tier,
  d.source_service,
  d.entity_type,
  d.entity_id,
  d.issue_type AS canonical_issue_type,
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

CREATE OR REPLACE VIEW engagement_insights_view
WITH (security_invoker = on) AS
SELECT
  id,
  company_id,
  report_tier,
  source_service,
  entity_type,
  entity_id,
  canonical_issue_type AS issue_type,
  title,
  description,
  evidence,
  impact_traffic,
  impact_conversion,
  impact_revenue,
  priority_score,
  effort_score,
  execution_score,
  confidence_score,
  recommendation,
  action_type,
  action_payload,
  status,
  last_changed_by,
  created_at,
  updated_at,
  resolved_at,
  ignored_at
FROM omnivyra_decision_feature_base_view
WHERE canonical_issue_type IN ('engagement_drop', 'content_gap');

CREATE OR REPLACE VIEW content_opportunities_view
WITH (security_invoker = on) AS
SELECT
  id,
  company_id,
  report_tier,
  source_service,
  entity_type,
  entity_id,
  canonical_issue_type AS issue_type,
  title,
  description,
  evidence,
  impact_traffic,
  impact_conversion,
  impact_revenue,
  priority_score,
  effort_score,
  execution_score,
  confidence_score,
  recommendation,
  action_type,
  action_payload,
  status,
  last_changed_by,
  created_at,
  updated_at,
  resolved_at,
  ignored_at
FROM omnivyra_decision_feature_base_view
WHERE canonical_issue_type IN ('seo_gap', 'content_gap');

CREATE OR REPLACE VIEW market_pulse_view
WITH (security_invoker = on) AS
SELECT
  company_id,
  COALESCE(
    NULLIF(BTRIM(evidence ->> 'keyword'), ''),
    NULLIF(BTRIM(evidence ->> 'content_cluster'), ''),
    NULLIF(BTRIM(evidence ->> 'market_topic'), ''),
    NULLIF(BTRIM(evidence ->> 'topic'), ''),
    canonical_issue_type
  ) AS pulse_key,
  canonical_issue_type AS issue_type,
  action_type,
  COUNT(*)::INT AS decision_count,
  ROUND(AVG(impact_traffic)::NUMERIC, 2) AS avg_impact_traffic,
  ROUND(AVG(impact_conversion)::NUMERIC, 2) AS avg_impact_conversion,
  ROUND(AVG(impact_revenue)::NUMERIC, 2) AS avg_impact_revenue,
  ROUND(AVG(confidence_score)::NUMERIC, 3) AS avg_confidence_score,
  ROUND(MAX(execution_score)::NUMERIC, 4) AS max_execution_score,
  MAX(created_at) AS latest_decision_at
FROM omnivyra_decision_feature_base_view
WHERE status = 'open'
  AND canonical_issue_type IN (
    'market_shift',
    'market_opportunity',
    'content_gap',
    'seo_gap',
    'keyword_opportunity',
    'impression_click_gap',
    'ranking_gap',
    'topic_gap',
    'weak_cluster_depth',
    'missing_supporting_content'
  )
GROUP BY
  company_id,
  COALESCE(
    NULLIF(BTRIM(evidence ->> 'keyword'), ''),
    NULLIF(BTRIM(evidence ->> 'content_cluster'), ''),
    NULLIF(BTRIM(evidence ->> 'market_topic'), ''),
    NULLIF(BTRIM(evidence ->> 'topic'), ''),
    canonical_issue_type
  ),
  canonical_issue_type,
  action_type;

COMMIT;
