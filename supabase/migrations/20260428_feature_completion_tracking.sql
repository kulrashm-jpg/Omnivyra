-- ============================================================
-- Feature Completion Tracking System
-- Tracks company/user activation milestone completions
-- Auto-computed based on actual data
-- ============================================================

-- ── 1. Feature Completion Table ──────────────────────────────

CREATE TABLE IF NOT EXISTS feature_completion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID, -- Optional: track per-user completion
  
  -- Feature identifier (enum-like)
  feature_key VARCHAR(100) NOT NULL,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed')),
  
  -- Optional metadata (context, notes, etc.)
  metadata JSONB,
  
  -- Timestamps
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Unique constraint: one feature per company per key
  UNIQUE(company_id, feature_key)
);

-- ── 2. Indexes for Performance ───────────────────────────────

CREATE INDEX IF NOT EXISTS idx_feature_completion_company_id 
  ON feature_completion(company_id);

CREATE INDEX IF NOT EXISTS idx_feature_completion_company_feature 
  ON feature_completion(company_id, feature_key);

CREATE INDEX IF NOT EXISTS idx_feature_completion_user_id 
  ON feature_completion(user_id);

CREATE INDEX IF NOT EXISTS idx_feature_completion_status 
  ON feature_completion(status);

-- ── 3. Update Trigger for updated_at ────────────────────────

CREATE OR REPLACE FUNCTION update_feature_completion_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_feature_completion_updated_at 
  ON feature_completion;

CREATE TRIGGER trigger_update_feature_completion_updated_at
  BEFORE UPDATE ON feature_completion
  FOR EACH ROW
  EXECUTE FUNCTION update_feature_completion_updated_at();

-- ── 4. RLS Policies (if enabled) ────────────────────────────

ALTER TABLE feature_completion ENABLE ROW LEVEL SECURITY;

-- Allow users to view feature completion for their companies
DROP POLICY IF EXISTS feature_completion_view_policy ON feature_completion;
CREATE POLICY feature_completion_view_policy ON feature_completion
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM user_company_roles 
      WHERE user_id = auth.uid()
    )
  );

-- Allow service role (backend) to manage
DROP POLICY IF EXISTS feature_completion_manage_policy ON feature_completion;
CREATE POLICY feature_completion_manage_policy ON feature_completion
  FOR ALL
  USING (auth.role() = 'service_role');

-- ── 5. View: Feature Completion Summary ──────────────────────

DROP VIEW IF EXISTS vw_feature_completion_summary;
CREATE VIEW vw_feature_completion_summary AS
SELECT
  company_id,
  COUNT(*) as total_features,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
  SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::DECIMAL / COUNT(*) * 100 as completion_percentage
FROM feature_completion
GROUP BY company_id;

-- ── 6. Idempotent Grant Permissions ─────────────────────────

DO $$ BEGIN
  -- These are optional and depend on your setup
  -- Uncomment if you have app_user role
  -- GRANT SELECT ON feature_completion TO app_user;
  -- GRANT SELECT ON vw_feature_completion_summary TO app_user;
END $$;
