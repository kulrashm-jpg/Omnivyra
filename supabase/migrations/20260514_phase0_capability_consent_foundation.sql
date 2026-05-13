-- Phase 0 — Capability axis + consent ledger + listening source abstraction.
-- Establishes foundation for explicit social-listening enablement. Does NOT
-- enable, schedule, or run any listening transport. Backward compatible:
-- existing publishing flows are unaffected; new tables default to pending /
-- inactive states and require explicit user action to enable.

CREATE TABLE IF NOT EXISTS integration_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  integration_id UUID NULL,
  platform TEXT NOT NULL,
  capability TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  granted_at TIMESTAMPTZ NULL,
  granted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  scope_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT 'ui',
  status TEXT NOT NULL DEFAULT 'pending',
  consent_record_id UUID NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_capabilities_capability_check
    CHECK (capability IN (
      'publish','listen','monitor_competitors',
      'ingest_dms','ingest_comments','ingest_mentions','ingest_communities'
    )),
  CONSTRAINT integration_capabilities_status_check
    CHECK (status IN ('active','revoked','pending')),
  CONSTRAINT integration_capabilities_source_check
    CHECK (source IN ('ui','api','system')),
  CONSTRAINT integration_capabilities_enabled_consistency
    CHECK (
      (enabled = FALSE)
      OR (enabled = TRUE AND granted_at IS NOT NULL AND status = 'active')
    ),
  CONSTRAINT integration_capabilities_unique
    UNIQUE (organization_id, platform, capability)
);

CREATE INDEX IF NOT EXISTS idx_integration_capabilities_org_platform
  ON integration_capabilities (organization_id, platform);

CREATE INDEX IF NOT EXISTS idx_integration_capabilities_org_active
  ON integration_capabilities (organization_id, capability)
  WHERE enabled = TRUE AND status = 'active';

CREATE TABLE IF NOT EXISTS consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  integration_id UUID NULL,
  platform TEXT NOT NULL,
  capability TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  granted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  revoked_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  scope_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'ui',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consent_records_capability_check
    CHECK (capability IN (
      'publish','listen','monitor_competitors',
      'ingest_dms','ingest_comments','ingest_mentions','ingest_communities'
    )),
  CONSTRAINT consent_records_source_check
    CHECK (source IN ('ui','api','system'))
);

CREATE INDEX IF NOT EXISTS idx_consent_records_org_platform_cap_time
  ON consent_records (organization_id, platform, capability, granted_at DESC);

CREATE INDEX IF NOT EXISTS idx_consent_records_active
  ON consent_records (organization_id, platform, capability)
  WHERE revoked_at IS NULL;

-- Append-only enforcement: only `revoked_at` / `revoked_by` may transition from
-- NULL -> NOT NULL. Every other column is immutable after insert. Deletes are
-- blocked outright. Together these provide an audit-safe consent trail.
CREATE OR REPLACE FUNCTION trg_consent_records_append_only_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NULL
     AND NEW.revoked_at IS NOT NULL
     AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
     AND OLD.integration_id IS NOT DISTINCT FROM NEW.integration_id
     AND OLD.platform IS NOT DISTINCT FROM NEW.platform
     AND OLD.capability IS NOT DISTINCT FROM NEW.capability
     AND OLD.consent_version IS NOT DISTINCT FROM NEW.consent_version
     AND OLD.granted_by IS NOT DISTINCT FROM NEW.granted_by
     AND OLD.granted_at IS NOT DISTINCT FROM NEW.granted_at
     AND OLD.scope_snapshot IS NOT DISTINCT FROM NEW.scope_snapshot
     AND OLD.source IS NOT DISTINCT FROM NEW.source THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'consent_records is append-only; only revoked_at / revoked_by may be set after insert';
END;
$$;

DROP TRIGGER IF EXISTS consent_records_append_only ON consent_records;
CREATE TRIGGER consent_records_append_only
  BEFORE UPDATE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION trg_consent_records_append_only_update();

CREATE OR REPLACE FUNCTION trg_consent_records_block_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'consent_records is append-only; deletes blocked';
END;
$$;

DROP TRIGGER IF EXISTS consent_records_no_delete ON consent_records;
CREATE TRIGGER consent_records_no_delete
  BEFORE DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION trg_consent_records_block_delete();

CREATE TABLE IF NOT EXISTS listening_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  integration_id UUID NULL,
  source_type TEXT NOT NULL,
  source_identifier TEXT NOT NULL,
  display_name TEXT NOT NULL,
  monitoring_modes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'inactive',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT listening_sources_status_check
    CHECK (status IN ('inactive','approved','active','paused','revoked')),
  CONSTRAINT listening_sources_unique
    UNIQUE (organization_id, source_type, source_identifier)
);

CREATE INDEX IF NOT EXISTS idx_listening_sources_org_status
  ON listening_sources (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_listening_sources_org_source_type
  ON listening_sources (organization_id, source_type);

CREATE OR REPLACE FUNCTION trg_phase0_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS integration_capabilities_set_updated_at ON integration_capabilities;
CREATE TRIGGER integration_capabilities_set_updated_at
  BEFORE UPDATE ON integration_capabilities
  FOR EACH ROW EXECUTE FUNCTION trg_phase0_set_updated_at();

DROP TRIGGER IF EXISTS listening_sources_set_updated_at ON listening_sources;
CREATE TRIGGER listening_sources_set_updated_at
  BEFORE UPDATE ON listening_sources
  FOR EACH ROW EXECUTE FUNCTION trg_phase0_set_updated_at();

ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS granted_scopes JSONB,
  ADD COLUMN IF NOT EXISTS granted_scopes_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scope_version_hash TEXT;
