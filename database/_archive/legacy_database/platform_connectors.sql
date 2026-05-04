-- =====================================================
-- PLATFORM CONNECTORS
-- Organization-level platform connections.
-- platform_key must reference platform_registry.
-- =====================================================
-- Prerequisite: Run platform_registry.sql first

CREATE TABLE IF NOT EXISTS platform_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  platform_key TEXT NOT NULL REFERENCES platform_registry(platform_key) ON DELETE RESTRICT,
  account_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, platform_key)
);

CREATE INDEX IF NOT EXISTS idx_platform_connectors_organization_id
  ON platform_connectors(organization_id);

CREATE INDEX IF NOT EXISTS idx_platform_connectors_platform_key
  ON platform_connectors(platform_key);

CREATE INDEX IF NOT EXISTS idx_platform_connectors_active
  ON platform_connectors(organization_id, platform_key) WHERE active = true;
