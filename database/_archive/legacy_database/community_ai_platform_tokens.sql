CREATE TABLE IF NOT EXISTS community_ai_platform_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  platform TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_ai_platform_tokens_tenant_id
  ON community_ai_platform_tokens(tenant_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_platform_tokens_organization_id
  ON community_ai_platform_tokens(organization_id);

CREATE INDEX IF NOT EXISTS idx_community_ai_platform_tokens_platform
  ON community_ai_platform_tokens(platform);
