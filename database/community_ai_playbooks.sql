CREATE TABLE IF NOT EXISTS community_ai_playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  scope JSONB,
  tone JSONB,
  user_rules JSONB,
  action_rules JSONB,
  automation_rules JSONB,
  automation_levels JSONB,
  limits JSONB,
  execution_modes JSONB,
  conflict_policy JSONB,
  safety JSONB,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

ALTER TABLE community_ai_playbooks
  ADD COLUMN IF NOT EXISTS automation_levels JSONB;

CREATE INDEX IF NOT EXISTS idx_community_ai_playbooks_tenant_id
  ON community_ai_playbooks(tenant_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_playbooks_organization_id
  ON community_ai_playbooks(organization_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_playbooks_status
  ON community_ai_playbooks(status);
