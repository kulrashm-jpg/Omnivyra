-- Phase 1B: Intelligence layer & decision feed.
--
-- Three additions, all additive:
--   1. New columns on market_pulse_findings for per-finding interpretation,
--      trust composite, correlation, cluster role, alert class, and the
--      user-action lifecycle (resolved / snoozed / escalated).
--   2. New columns on market_pulse_runs for the executive summary, top
--      takeaways, immediate-attention list, market-direction signal, and
--      the change-intelligence diff vs the prior run.
--   3. New table market_pulse_finding_actions — append-only audit log of
--      user actions on findings (resolve / snooze / escalate / promote /
--      share). Findings carry the latest state; this table holds history.
--
-- All columns NULLABLE so legacy rows render unchanged. CHECK constraints
-- are permissive (NULL passes) for the same reason.

-- ── 1. market_pulse_findings — interpretation + trust + correlation + actions ──
ALTER TABLE market_pulse_findings
  ADD COLUMN IF NOT EXISTS interpretation_text         TEXT NULL,
  ADD COLUMN IF NOT EXISTS strategic_implication       TEXT NULL,
  ADD COLUMN IF NOT EXISTS urgency_reason              TEXT NULL,
  ADD COLUMN IF NOT EXISTS operational_impact          TEXT NULL,
  ADD COLUMN IF NOT EXISTS opportunity_window          TEXT NULL,
  ADD COLUMN IF NOT EXISTS affected_business_areas     TEXT[] NULL,
  ADD COLUMN IF NOT EXISTS evidence_strength           NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS source_diversity_score      NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS freshness_factor            NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS contradiction_factor        NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS recurrence_factor           NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS region_consistency_factor   NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS confidence_breakdown        JSONB  NULL,
  ADD COLUMN IF NOT EXISTS correlated_findings         JSONB  NULL,
  ADD COLUMN IF NOT EXISTS cluster_role                TEXT   NULL,
  ADD COLUMN IF NOT EXISTS alert_class                 TEXT   NULL,
  ADD COLUMN IF NOT EXISTS priority_explanation        TEXT   NULL,
  ADD COLUMN IF NOT EXISTS resolved_at                 TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS snoozed_until               TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS escalation_tracking         BOOLEAN NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS user_action_state           TEXT   NULL DEFAULT 'open';

ALTER TABLE market_pulse_findings
  DROP CONSTRAINT IF EXISTS market_pulse_findings_cluster_role_check;
ALTER TABLE market_pulse_findings
  ADD CONSTRAINT market_pulse_findings_cluster_role_check
  CHECK (cluster_role IS NULL OR cluster_role IN ('isolated', 'repeated', 'market_wide', 'localized_anomaly'));

ALTER TABLE market_pulse_findings
  DROP CONSTRAINT IF EXISTS market_pulse_findings_alert_class_check;
ALTER TABLE market_pulse_findings
  ADD CONSTRAINT market_pulse_findings_alert_class_check
  CHECK (alert_class IS NULL OR alert_class IN (
    'strategic_risk', 'competitor_escalation', 'regulatory_exposure',
    'market_acceleration', 'opportunity_breakout'
  ));

ALTER TABLE market_pulse_findings
  DROP CONSTRAINT IF EXISTS market_pulse_findings_user_action_state_check;
ALTER TABLE market_pulse_findings
  ADD CONSTRAINT market_pulse_findings_user_action_state_check
  CHECK (user_action_state IS NULL OR user_action_state IN ('open', 'resolved', 'snoozed', 'escalated', 'promoted'));

-- Index for the feed view's "show open + due-soon snoozed first" ordering.
CREATE INDEX IF NOT EXISTS idx_market_pulse_findings_run_state_priority
  ON market_pulse_findings (run_id, user_action_state, priority_tier);

-- ── 2. market_pulse_runs — executive synthesis + change intelligence ──────────
ALTER TABLE market_pulse_runs
  ADD COLUMN IF NOT EXISTS executive_summary          TEXT  NULL,
  ADD COLUMN IF NOT EXISTS top_takeaways              JSONB NULL,
  ADD COLUMN IF NOT EXISTS immediate_attention_items  JSONB NULL,
  ADD COLUMN IF NOT EXISTS strategic_shift_assessment TEXT  NULL,
  ADD COLUMN IF NOT EXISTS market_direction           TEXT  NULL,
  ADD COLUMN IF NOT EXISTS opportunity_pressure       NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS risk_pressure              NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS change_summary             JSONB NULL,
  ADD COLUMN IF NOT EXISTS prior_run_id               UUID  NULL;

ALTER TABLE market_pulse_runs
  DROP CONSTRAINT IF EXISTS market_pulse_runs_market_direction_check;
ALTER TABLE market_pulse_runs
  ADD CONSTRAINT market_pulse_runs_market_direction_check
  CHECK (market_direction IS NULL OR market_direction IN ('expanding', 'contracting', 'mixed', 'stable'));

CREATE INDEX IF NOT EXISTS idx_market_pulse_runs_company_completed
  ON market_pulse_runs (company_id, completed_at DESC NULLS LAST);

-- ── 3. market_pulse_finding_actions — append-only audit log ───────────────────
CREATE TABLE IF NOT EXISTS market_pulse_finding_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id   UUID NOT NULL REFERENCES market_pulse_findings(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL,
  run_id       UUID NULL,
  action_type  TEXT NOT NULL,
  payload      JSONB NULL,
  performed_by TEXT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE market_pulse_finding_actions
  DROP CONSTRAINT IF EXISTS market_pulse_finding_actions_action_type_check;
ALTER TABLE market_pulse_finding_actions
  ADD CONSTRAINT market_pulse_finding_actions_action_type_check
  CHECK (action_type IN (
    'resolve', 'reopen', 'snooze', 'unsnooze', 'escalate', 'promote', 'share', 'feedback'
  ));

CREATE INDEX IF NOT EXISTS idx_market_pulse_finding_actions_finding
  ON market_pulse_finding_actions (finding_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_pulse_finding_actions_company
  ON market_pulse_finding_actions (company_id, created_at DESC);
