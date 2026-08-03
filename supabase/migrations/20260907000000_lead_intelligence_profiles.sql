-- INT-001 Phase 4 — Lead Intelligence profile store (ADDITIVE ONLY).
-- One generated-intelligence envelope per (company, lead). A NEW table on
-- purpose: reusing lead_intelligence would surface these envelopes as leads in
-- the existing read-union (leadIntelligenceReadService), and writing into
-- leads.metadata would mutate capture-owned rows — both would change existing
-- runtime behaviour. Modifies/migrates NOTHING existing. RLS mirrors the
-- existing service-role pattern; tenant isolation via company_id + RLS.

CREATE TABLE IF NOT EXISTS lead_intelligence_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           text NOT NULL,
  lead_id              text NOT NULL,
  intelligence         jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnostics          jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_fingerprint    text NOT NULL,
  engine_version       text NOT NULL,
  generation_version   integer NOT NULL DEFAULT 1,
  schema_version       integer NOT NULL DEFAULT 1,
  generated_at         timestamptz NOT NULL,
  rebuild_requested_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_intelligence_profiles_lead_unique UNIQUE (company_id, lead_id),
  CONSTRAINT lead_intelligence_profiles_fingerprint_not_blank CHECK (length(btrim(input_fingerprint)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_lead_intel_profiles_company_generated
  ON lead_intelligence_profiles (company_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_intel_profiles_rebuild_pending
  ON lead_intelligence_profiles (company_id, rebuild_requested_at)
  WHERE rebuild_requested_at IS NOT NULL;

ALTER TABLE lead_intelligence_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY lead_intelligence_profiles_service_role ON lead_intelligence_profiles
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
