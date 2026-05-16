-- Phase 1 — Operational optimization indexes.
-- Pure additive: no column changes, no table changes, no data writes.
-- Targets the read paths exercised by the capability aggregation service so
-- the Active Leads tab and capability panel return in a single round trip.

-- integration_capabilities: hot path is "list all enabled capabilities for a
-- company across platforms". Phase 0 already indexes (org, capability) WHERE
-- enabled=true AND status='active'; add a denser composite for the typical
-- aggregator query that filters on org and status without forcing enabled.
CREATE INDEX IF NOT EXISTS idx_integration_capabilities_org_status_cap
  ON integration_capabilities (organization_id, status, capability);

-- consent_records: active-consent lookup ("latest non-revoked consent for an
-- org+platform+capability"). Phase 0 has an (org, platform, cap) partial
-- index WHERE revoked_at IS NULL; add a (granted_at DESC) sort key so the
-- ORDER BY in getActiveConsent does not require a sort step.
CREATE INDEX IF NOT EXISTS idx_consent_records_org_platform_cap_active_recent
  ON consent_records (organization_id, platform, capability, granted_at DESC)
  WHERE revoked_at IS NULL;

-- consent_records: stale-consent diagnostic ("consents older than N days
-- that are still active"). Indexes the diagnostic scan path used by the
-- health service.
CREATE INDEX IF NOT EXISTS idx_consent_records_active_granted_at
  ON consent_records (granted_at)
  WHERE revoked_at IS NULL;

-- listening_sources: source-readiness diagnostic enumerates by status.
-- Already covered by Phase 0 idx_listening_sources_org_status; add a
-- (status, monitoring_modes) compound so the eligibility evaluator filtering
-- on status='ready' AND 'on_demand' or 'scheduled' uses a single index.
-- GIN on monitoring_modes[] supports the array-contains check.
CREATE INDEX IF NOT EXISTS idx_listening_sources_monitoring_modes_gin
  ON listening_sources USING GIN (monitoring_modes);

-- social_accounts: capability aggregation joins on
-- (company_id, platform, is_active) where the tenant scope is the company.
-- Production today has rows without company_id (legacy null company) so we
-- index both shapes. company_id can be NULL so we include the partial
-- variant for tenant-scoped lookups.
CREATE INDEX IF NOT EXISTS idx_social_accounts_company_platform_active
  ON social_accounts (company_id, platform)
  WHERE is_active = TRUE AND company_id IS NOT NULL;

-- Granted-scopes lookup path: when validating scope sufficiency, the
-- aggregator pulls (company_id, platform) → granted_scopes. JSONB column;
-- the column itself isn't worth indexing, but covering (company_id, platform)
-- as above plus including scope_version_hash via the existing row read is
-- enough. No additional index needed here.
