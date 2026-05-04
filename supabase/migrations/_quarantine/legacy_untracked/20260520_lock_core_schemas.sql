-- =============================================================================
-- Phase 7 Final — Lock Core Schemas
--
-- Marks the five load-bearing cost-tracking tables as frozen. Any future
-- ALTER/DROP requires an explicit system review per the change protocol in
-- docs/VARIABLE-COST-TRACKING-ROADMAP.md.
--
-- Also creates two monitoring views (cost_monitoring_daily_view and
-- cost_margin_daily_view) for the first-14-days baseline tracking.
-- =============================================================================

COMMENT ON TABLE unified_transactions      IS 'CORE LEDGER — DO NOT ALTER WITHOUT REVIEW. Single source of truth for cost + credits + margin per logical action. See docs/VARIABLE-COST-TRACKING-ROADMAP.md change protocol.';
COMMENT ON TABLE llm_model_pricing         IS 'PRICING TABLE — DO NOT ALTER WITHOUT REVIEW. Versioned per-(provider, model, kind) USD rates. Writes only via POST /api/admin/pricing/update.';
COMMENT ON TABLE action_pricing_config     IS 'PRICING TABLE — DO NOT ALTER WITHOUT REVIEW. Versioned per-action credit_cost override + cost_multiplier. Writes via admin API or pricing/apply.';
COMMENT ON TABLE pricing_intelligence      IS 'ANALYTICS TABLE — DO NOT ALTER WITHOUT REVIEW. Weekly margin snapshot populated by runWeeklyPricingAnalysis().';
COMMENT ON TABLE cost_anomalies            IS 'ALERTING TABLE — DO NOT ALTER WITHOUT REVIEW. Raw anomaly log; feeds the operator alerts table.';

-- ───────────────────────────────────────────────────────────────────────────
-- Monitoring views (first-14-days baseline)
-- ───────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS cost_monitoring_daily_view;
CREATE VIEW cost_monitoring_daily_view AS
SELECT
  DATE_TRUNC('day', detected_at)::date AS day,
  anomaly_type,
  severity,
  COUNT(*)                             AS anomaly_count
FROM cost_anomalies
WHERE detected_at >= (CURRENT_DATE - INTERVAL '90 days')
GROUP BY DATE_TRUNC('day', detected_at)::date, anomaly_type, severity
ORDER BY day DESC, anomaly_count DESC;

COMMENT ON VIEW cost_monitoring_daily_view IS 'Daily anomaly rollup for the first-14-days monitoring baseline. Filter by anomaly_type = pricing_missing / unknown_action_key / cost_credit_mismatch per the escalation rules.';

DROP VIEW IF EXISTS cost_margin_daily_view;
CREATE VIEW cost_margin_daily_view AS
SELECT
  DATE_TRUNC('day', created_at)::date      AS day,
  SUM(COALESCE(api_cost_usd, 0))           AS total_api_cost_usd,
  SUM(COALESCE(credits_value_usd, 0))      AS total_credits_value_usd,
  SUM(margin_usd)                          AS margin_usd,
  SUM(margin_usd) FILTER (WHERE margin_usd < 0) AS negative_margin_total_usd,
  COUNT(*)                                 AS event_count,
  COUNT(*) FILTER (WHERE margin_usd < 0)   AS negative_margin_event_count
FROM unified_transactions
WHERE final_attempt = true
  AND created_at >= (CURRENT_DATE - INTERVAL '90 days')
GROUP BY DATE_TRUNC('day', created_at)::date
ORDER BY day DESC;

COMMENT ON VIEW cost_margin_daily_view IS 'Daily cost / credits / margin rollup. Watch the total_api_cost vs credits_value delta per the first-14-days baseline.';
