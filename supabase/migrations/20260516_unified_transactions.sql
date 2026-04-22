-- =============================================================================
-- Phase 5 — Unified Transactions Ledger
--
-- Consolidates usage_events + credit_usage_log + credit_transactions into a
-- single reconciled row per logical LLM/credit action. Dual-written by the
-- application layer during the transition; analytics and reporting read only
-- this table (and its two views).
--
-- Retry semantics: one usage_events row → one unified_transactions row.
-- retry_attempt / final_attempt promote from metadata to first-class columns.
--
-- Enforcement: DB-level CHECK constraints reject rows missing action_key
-- (except source_type='internal' loopback) or missing api_cost on costed
-- sources. App-level write path catches CHECK violations, emits a
-- cost_anomalies row, and continues without the unified row.
-- =============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- 1. unified_transactions
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unified_transactions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  user_id             uuid,

  action_key          text,                               -- CHECK below allows null only for source_type='internal' with error_flag
  source_type         text        NOT NULL
                                  CHECK (source_type IN (
                                    'llm', 'embedding', 'cache',
                                    'external_api', 'automation_execution',
                                    'system', 'internal'
                                  )),

  provider_name       text,
  model_name          text,

  input_tokens        integer,
  output_tokens       integer,
  total_tokens        integer,

  api_cost_usd        numeric(20, 10),                    -- null OK for cache/internal/system/error
  credits_charged     integer,                            -- integer to match credit_usage_log.credits
  credits_value_usd   numeric(20, 10),                    -- credits_charged × org credit_rate_usd (computed at write time)

  margin_usd          numeric(20, 10)                     -- credits_value_usd - api_cost_usd; generated
                      GENERATED ALWAYS AS (
                        COALESCE(credits_value_usd, 0) - COALESCE(api_cost_usd, 0)
                      ) STORED,

  retry_attempt       integer     NOT NULL DEFAULT 1 CHECK (retry_attempt >= 1),
  final_attempt       boolean     NOT NULL DEFAULT true,
  error_flag          boolean     NOT NULL DEFAULT false,
  error_type          text,

  reference_type      text,
  reference_id        text,

  pricing_snapshot    jsonb,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),

  -- ── Enforcement CHECKs ──────────────────────────────────────────────────
  -- Every row must have an action_key UNLESS it's an internal row that
  -- wasn't resolvable (e.g. unknown process_type). Enforcement below lets
  -- source_type='internal' through without action_key for loopback safety.
  CONSTRAINT unified_txn_action_key_required CHECK (
    action_key IS NOT NULL OR source_type = 'internal'
  ),

  -- Costed sources (llm, embedding, external_api) must carry a cost OR be
  -- flagged as an error. cache/system/internal/automation_execution can
  -- legitimately have null cost.
  CONSTRAINT unified_txn_cost_required CHECK (
    source_type IN ('cache', 'system', 'internal', 'automation_execution')
    OR error_flag = true
    OR api_cost_usd IS NOT NULL
  ),

  -- Tokens must be non-negative when set.
  CONSTRAINT unified_txn_tokens_non_negative CHECK (
    (input_tokens  IS NULL OR input_tokens  >= 0)
    AND (output_tokens IS NULL OR output_tokens >= 0)
    AND (total_tokens  IS NULL OR total_tokens  >= 0)
  )
);

-- Indexes for the org-aggregation read path
CREATE INDEX IF NOT EXISTS idx_unified_txn_org_created
  ON unified_transactions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unified_txn_action_key
  ON unified_transactions (action_key)
  WHERE action_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_unified_txn_model
  ON unified_transactions (model_name)
  WHERE model_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_unified_txn_source
  ON unified_transactions (source_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unified_txn_final
  ON unified_transactions (organization_id, final_attempt, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unified_txn_negative_margin
  ON unified_transactions (organization_id, created_at DESC)
  WHERE margin_usd < 0;

ALTER TABLE unified_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS unified_txn_service_all ON unified_transactions;
CREATE POLICY unified_txn_service_all ON unified_transactions
  FOR ALL USING (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 2. org_economics_view — per-org × action × model roll-up
--    Regular view (not materialized) so it reflects the ledger in real time.
--    Filters on final_attempt=true so intermediate retries don't double-count.
-- ───────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS org_economics_view;
CREATE VIEW org_economics_view AS
SELECT
  organization_id,
  action_key,
  model_name,
  source_type,
  DATE_TRUNC('day', created_at) AS day,
  SUM(COALESCE(api_cost_usd, 0))       AS total_api_cost_usd,
  SUM(COALESCE(credits_charged, 0))    AS total_credits_used,
  SUM(COALESCE(credits_value_usd, 0))  AS credits_value_usd,
  SUM(margin_usd)                      AS margin_usd,
  BOOL_OR(margin_usd < 0)              AS negative_margin_flag,
  SUM(COALESCE(total_tokens, 0))       AS total_tokens,
  COUNT(*)                             AS event_count,
  COUNT(*) FILTER (WHERE error_flag)   AS error_count
FROM unified_transactions
WHERE final_attempt = true
GROUP BY organization_id, action_key, model_name, source_type, DATE_TRUNC('day', created_at);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. unified_transactions_with_anomalies_view
--    Left-joins cost_anomalies onto unified_transactions so analytics can
--    surface rows that tripped a guardrail. Anomaly match is fuzzy (by org
--    + action_key + model + ≤ 5s time window) because cost_anomalies does
--    not carry a unified_txn_id FK.
-- ───────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS unified_transactions_with_anomalies_view;
CREATE VIEW unified_transactions_with_anomalies_view AS
SELECT
  t.*,
  a.anomaly_type,
  a.severity AS anomaly_severity,
  a.detected_at AS anomaly_detected_at,
  a.metadata AS anomaly_metadata
FROM unified_transactions t
LEFT JOIN LATERAL (
  SELECT anomaly_type, severity, detected_at, metadata
    FROM cost_anomalies a
   WHERE a.organization_id = t.organization_id
     AND (a.action_key IS NULL OR a.action_key = t.action_key)
     AND (a.model_name IS NULL OR a.model_name = t.model_name)
     AND a.detected_at BETWEEN t.created_at - INTERVAL '5 seconds'
                          AND  t.created_at + INTERVAL '5 seconds'
   ORDER BY ABS(EXTRACT(EPOCH FROM (a.detected_at - t.created_at)))
   LIMIT 1
) a ON true;
