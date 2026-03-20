-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5 — Autonomous Campaign System
-- All DDL for the self-operating campaign loop.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: Autonomous mode flags on company_settings ────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_settings' AND column_name = 'autonomous_mode'
  ) THEN
    ALTER TABLE company_settings ADD COLUMN autonomous_mode boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_settings' AND column_name = 'approval_required'
  ) THEN
    ALTER TABLE company_settings ADD COLUMN approval_required boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_settings' AND column_name = 'risk_tolerance'
  ) THEN
    ALTER TABLE company_settings ADD COLUMN risk_tolerance text NOT NULL DEFAULT 'balanced'
      CHECK (risk_tolerance IN ('aggressive', 'balanced', 'conservative'));
  END IF;
END $$;

-- ── Step 4: pending_campaigns — awaiting human approval ──────────────────────
CREATE TABLE IF NOT EXISTS pending_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  campaign_plan    jsonb NOT NULL,
  generation_meta  jsonb NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  expires_at       timestamptz NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  reviewed_by      text
);

CREATE INDEX IF NOT EXISTS pending_campaigns_company_status_idx ON pending_campaigns(company_id, status);
CREATE INDEX IF NOT EXISTS pending_campaigns_expires_at_idx ON pending_campaigns(expires_at);

ALTER TABLE pending_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON pending_campaigns
  FOR ALL USING (auth.role() = 'service_role');

-- ── Step 9: campaign_learnings ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_learnings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  campaign_id         uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  learning_type       text NOT NULL CHECK (learning_type IN ('success', 'failure', 'platform', 'content_pattern', 'timing', 'hook')),
  platform            text,
  content_type        text,
  pattern             text NOT NULL,
  engagement_impact   float NOT NULL DEFAULT 0,  -- positive = good, negative = bad
  confidence          float NOT NULL DEFAULT 0.5,
  sample_size         int NOT NULL DEFAULT 1,
  metadata            jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_learnings_company_type_idx ON campaign_learnings(company_id, learning_type);
CREATE INDEX IF NOT EXISTS campaign_learnings_platform_idx ON campaign_learnings(platform);
CREATE INDEX IF NOT EXISTS campaign_learnings_company_id_idx ON campaign_learnings(company_id);

ALTER TABLE campaign_learnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON campaign_learnings
  FOR ALL USING (auth.role() = 'service_role');

-- ── Step 11: autonomous_decision_logs ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS autonomous_decision_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  campaign_id     uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  decision_type   text NOT NULL CHECK (decision_type IN (
    'generate', 'approve', 'reject', 'auto_activate',
    'optimize', 'scale', 'pause', 'recover', 'learn'
  )),
  reason          text NOT NULL,
  metrics_used    jsonb NOT NULL DEFAULT '{}',
  outcome         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS autonomous_decision_logs_company_idx ON autonomous_decision_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS autonomous_decision_logs_campaign_idx ON autonomous_decision_logs(campaign_id);
CREATE INDEX IF NOT EXISTS autonomous_decision_logs_type_idx ON autonomous_decision_logs(decision_type);

ALTER TABLE autonomous_decision_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON autonomous_decision_logs
  FOR ALL USING (auth.role() = 'service_role');
