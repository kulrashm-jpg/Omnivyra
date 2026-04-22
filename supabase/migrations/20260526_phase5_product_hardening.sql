-- =============================================================================
-- Phase 5 — product-level hardening
--
-- 1. ai_suggestions table — track shown / accepted / rejected with
--    correlation id so execution outcomes join the suggestion lifecycle.
-- 2. Normalize platform alias: 'x' → 'twitter' on action and metric tables
--    so intelligence queries don't double-count the same platform.
-- 3. Migrate legacy 'skipped_guardrail' status to canonical 'skipped'.
-- 4. Intelligence views:
--      community_ai_execution_success_rate — per (platform, action_type)
--      ai_suggestion_acceptance_rate       — per (platform, action_type)
-- =============================================================================

BEGIN;

-- ── 1. ai_suggestions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_suggestions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL,
  platform                    text NOT NULL,
  action_type                 text NOT NULL,
  target_id                   text,
  content                     text,
  model                       text,
  shown_at                    timestamptz NOT NULL DEFAULT NOW(),
  accepted_at                 timestamptz,
  rejected_at                 timestamptz,
  rejected_reason             text,
  execution_correlation_id    uuid,
  action_id                   uuid,
  metadata                    jsonb,
  created_at                  timestamptz NOT NULL DEFAULT NOW(),
  updated_at                  timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_suggestions_outcome_exclusive
    CHECK (accepted_at IS NULL OR rejected_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_ai_suggestions_org_shown_at
  ON ai_suggestions (organization_id, shown_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_correlation
  ON ai_suggestions (execution_correlation_id)
  WHERE execution_correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_action
  ON ai_suggestions (action_id)
  WHERE action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_platform_action
  ON ai_suggestions (platform, action_type, shown_at DESC);

ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'ai_suggestions'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON ai_suggestions
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ── 2. Normalize platform alias: 'x' → 'twitter' ────────────────────────────
-- Execution / metrics / signals tables all benefit from a single canonical
-- value so intelligence rollups are not split across synonyms. Only tables
-- in the execution pipeline are touched; source-of-truth tables owned by
-- other systems are left untouched.
UPDATE community_ai_actions
SET    platform = 'twitter'
WHERE  platform = 'x';

UPDATE community_ai_execution_metric_events
SET    platform = 'twitter'
WHERE  platform = 'x';

UPDATE community_ai_execution_metrics_daily
SET    platform = 'twitter'
WHERE  platform = 'x';

UPDATE community_ai_metric_dlq
SET    platform = 'twitter'
WHERE  platform = 'x';

UPDATE campaign_activity_engagement_signals
SET    platform = 'twitter'
WHERE  platform = 'x';

-- ── 3. Clean legacy 'skipped_guardrail' status ──────────────────────────────
-- The canonical status CHECK (from 20260522) does not include
-- 'skipped_guardrail'; migrate any surviving rows onto 'skipped' and push
-- the original value into execution_result.skip_reason for audit.
UPDATE community_ai_actions
SET    status           = 'skipped',
       execution_result = COALESCE(execution_result, '{}'::jsonb)
                          || jsonb_build_object(
                               'skip_reason', COALESCE(execution_result->>'skip_reason', 'GUARDRAIL'),
                               'legacy_status', 'skipped_guardrail',
                               'source', COALESCE(execution_result->>'source', 'migration')
                             ),
       updated_at       = NOW()
WHERE  status = 'skipped_guardrail';

-- ── 4. Intelligence views ───────────────────────────────────────────────────
-- Executed-vs-sent_unverified is intentionally split so operators can see
-- "platform-confirmed" vs "fired-but-unverified" success separately.
CREATE OR REPLACE VIEW community_ai_execution_success_rate AS
SELECT
  organization_id,
  COALESCE(platform,    '') AS platform,
  COALESCE(action_type, '') AS action_type,
  SUM(CASE WHEN status = 'executed'         THEN 1 ELSE 0 END)::bigint AS executed_count,
  SUM(CASE WHEN status = 'sent_unverified'  THEN 1 ELSE 0 END)::bigint AS sent_unverified_count,
  SUM(CASE WHEN status = 'failed'           THEN 1 ELSE 0 END)::bigint AS failed_count,
  SUM(CASE WHEN status IN ('executed','sent_unverified','failed') THEN 1 ELSE 0 END)::bigint AS total_terminal,
  CASE
    WHEN SUM(CASE WHEN status IN ('executed','sent_unverified','failed') THEN 1 ELSE 0 END) = 0 THEN NULL
    ELSE ROUND(
      100.0 * SUM(CASE WHEN status IN ('executed','sent_unverified') THEN 1 ELSE 0 END)
      / NULLIF(SUM(CASE WHEN status IN ('executed','sent_unverified','failed') THEN 1 ELSE 0 END), 0),
      2
    )
  END AS success_rate_pct,
  CASE
    WHEN SUM(CASE WHEN status IN ('executed','sent_unverified','failed') THEN 1 ELSE 0 END) = 0 THEN NULL
    ELSE ROUND(
      100.0 * SUM(CASE WHEN status = 'executed' THEN 1 ELSE 0 END)
      / NULLIF(SUM(CASE WHEN status IN ('executed','sent_unverified','failed') THEN 1 ELSE 0 END), 0),
      2
    )
  END AS confirmed_rate_pct
FROM   community_ai_actions
WHERE  status IN ('executed','sent_unverified','failed')
GROUP  BY organization_id, COALESCE(platform, ''), COALESCE(action_type, '');

COMMENT ON VIEW community_ai_execution_success_rate IS
  'Per (org, platform, action_type): executed vs sent_unverified vs failed counts and two ratios — success_rate_pct (executed+sent_unverified) and confirmed_rate_pct (executed only).';

CREATE OR REPLACE VIEW ai_suggestion_acceptance_rate AS
SELECT
  organization_id,
  COALESCE(platform,    '') AS platform,
  COALESCE(action_type, '') AS action_type,
  COALESCE(model,       '') AS model,
  COUNT(*)::bigint                                                     AS shown_count,
  SUM(CASE WHEN accepted_at IS NOT NULL THEN 1 ELSE 0 END)::bigint     AS accepted_count,
  SUM(CASE WHEN rejected_at IS NOT NULL THEN 1 ELSE 0 END)::bigint     AS rejected_count,
  CASE
    WHEN COUNT(*) = 0 THEN NULL
    ELSE ROUND(100.0 * SUM(CASE WHEN accepted_at IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2)
  END AS acceptance_rate_pct
FROM   ai_suggestions
GROUP  BY organization_id, COALESCE(platform, ''), COALESCE(action_type, ''), COALESCE(model, '');

COMMENT ON VIEW ai_suggestion_acceptance_rate IS
  'Per (org, platform, action_type, model): shown / accepted / rejected counts and acceptance_rate_pct.';

GRANT SELECT ON community_ai_execution_success_rate TO service_role;
GRANT SELECT ON ai_suggestion_acceptance_rate       TO service_role;

COMMIT;
