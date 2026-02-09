CREATE TABLE IF NOT EXISTS community_ai_auto_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  rule_name TEXT NOT NULL,
  condition JSONB NOT NULL,
  action_type TEXT NOT NULL,
  max_risk_level TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_ai_auto_rules_tenant_org
  ON community_ai_auto_rules(tenant_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_auto_rules_active
  ON community_ai_auto_rules(is_active);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'community_ai_auto_rules_action_type_check'
  ) THEN
    ALTER TABLE community_ai_auto_rules
      DROP CONSTRAINT community_ai_auto_rules_action_type_check;
  END IF;
  ALTER TABLE community_ai_auto_rules
    ADD CONSTRAINT community_ai_auto_rules_action_type_check
    CHECK (action_type IN ('like', 'reply', 'share', 'follow', 'schedule'));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'community_ai_auto_rules_risk_level_check'
  ) THEN
    ALTER TABLE community_ai_auto_rules
      DROP CONSTRAINT community_ai_auto_rules_risk_level_check;
  END IF;
  ALTER TABLE community_ai_auto_rules
    ADD CONSTRAINT community_ai_auto_rules_risk_level_check
    CHECK (max_risk_level IN ('low', 'medium'));
END $$;
