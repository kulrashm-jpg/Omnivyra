BEGIN;

-- Company Context Intelligence Foundation
-- Additive normalized entities for exposure/dependency-aware company context.

CREATE OR REPLACE FUNCTION omnivyra_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS company_revenue_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_industry TEXT,
  customer_segment TEXT,
  geography TEXT,
  revenue_percentage NUMERIC(5,2),
  strategic_priority TEXT,
  notes TEXT,
  confidence NUMERIC(4,3),
  source TEXT NOT NULL DEFAULT 'unknown',
  user_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  inferred_by TEXT,
  last_verified_at TIMESTAMPTZ,
  stale_at TIMESTAMPTZ,
  review_status TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_revenue_segments_revenue_pct_valid
    CHECK (revenue_percentage IS NULL OR (revenue_percentage >= 0 AND revenue_percentage <= 100)),
  CONSTRAINT company_revenue_segments_confidence_valid
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT company_revenue_segments_source_valid
    CHECK (source IN ('user', 'ai_inferred', 'integration', 'import', 'system', 'unknown')),
  CONSTRAINT company_revenue_segments_review_status_valid
    CHECK (review_status IN ('missing', 'unknown', 'inferred', 'user_confirmed', 'stale', 'needs_review'))
);

CREATE INDEX IF NOT EXISTS idx_company_revenue_segments_company
  ON company_revenue_segments(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS company_geographic_exposures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geography TEXT,
  exposure_type TEXT NOT NULL,
  exposure_percentage NUMERIC(5,2),
  criticality TEXT,
  confidence NUMERIC(4,3),
  source TEXT NOT NULL DEFAULT 'unknown',
  user_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  inferred_by TEXT,
  last_verified_at TIMESTAMPTZ,
  stale_at TIMESTAMPTZ,
  review_status TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_geographic_exposures_type_valid
    CHECK (exposure_type IN ('revenue', 'operations', 'workforce', 'customers', 'vendors')),
  CONSTRAINT company_geographic_exposures_pct_valid
    CHECK (exposure_percentage IS NULL OR (exposure_percentage >= 0 AND exposure_percentage <= 100)),
  CONSTRAINT company_geographic_exposures_criticality_valid
    CHECK (criticality IS NULL OR criticality IN ('low', 'medium', 'high', 'critical', 'unknown')),
  CONSTRAINT company_geographic_exposures_confidence_valid
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT company_geographic_exposures_source_valid
    CHECK (source IN ('user', 'ai_inferred', 'integration', 'import', 'system', 'unknown')),
  CONSTRAINT company_geographic_exposures_review_status_valid
    CHECK (review_status IN ('missing', 'unknown', 'inferred', 'user_confirmed', 'stale', 'needs_review'))
);

CREATE INDEX IF NOT EXISTS idx_company_geographic_exposures_company
  ON company_geographic_exposures(company_id, exposure_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS company_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL,
  dependency_name TEXT,
  dependency_region TEXT,
  criticality TEXT,
  operational_sensitivity TEXT,
  notes TEXT,
  confidence NUMERIC(4,3),
  source TEXT NOT NULL DEFAULT 'unknown',
  user_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  inferred_by TEXT,
  last_verified_at TIMESTAMPTZ,
  stale_at TIMESTAMPTZ,
  review_status TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_dependencies_type_valid
    CHECK (dependency_type IN ('cloud', 'vendor', 'supplier', 'logistics', 'labor', 'platform', 'channel', 'regulatory', 'technology', 'other')),
  CONSTRAINT company_dependencies_criticality_valid
    CHECK (criticality IS NULL OR criticality IN ('low', 'medium', 'high', 'critical', 'unknown')),
  CONSTRAINT company_dependencies_confidence_valid
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT company_dependencies_source_valid
    CHECK (source IN ('user', 'ai_inferred', 'integration', 'import', 'system', 'unknown')),
  CONSTRAINT company_dependencies_review_status_valid
    CHECK (review_status IN ('missing', 'unknown', 'inferred', 'user_confirmed', 'stale', 'needs_review'))
);

CREATE INDEX IF NOT EXISTS idx_company_dependencies_company
  ON company_dependencies(company_id, dependency_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS company_regulatory_exposures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  jurisdiction TEXT,
  regulation_type TEXT,
  applicability TEXT,
  severity TEXT,
  notes TEXT,
  confidence NUMERIC(4,3),
  source TEXT NOT NULL DEFAULT 'unknown',
  user_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  inferred_by TEXT,
  last_verified_at TIMESTAMPTZ,
  stale_at TIMESTAMPTZ,
  review_status TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_regulatory_exposures_severity_valid
    CHECK (severity IS NULL OR severity IN ('low', 'medium', 'high', 'critical', 'unknown')),
  CONSTRAINT company_regulatory_exposures_confidence_valid
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT company_regulatory_exposures_source_valid
    CHECK (source IN ('user', 'ai_inferred', 'integration', 'import', 'system', 'unknown')),
  CONSTRAINT company_regulatory_exposures_review_status_valid
    CHECK (review_status IN ('missing', 'unknown', 'inferred', 'user_confirmed', 'stale', 'needs_review'))
);

CREATE INDEX IF NOT EXISTS idx_company_regulatory_exposures_company
  ON company_regulatory_exposures(company_id, jurisdiction, updated_at DESC);

CREATE TABLE IF NOT EXISTS company_workforce_profile (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  workforce_model TEXT,
  hiring_markets JSONB NOT NULL DEFAULT '[]'::jsonb,
  contractor_dependency_level TEXT,
  immigration_dependency_level TEXT,
  key_skill_dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  labor_sensitivity_level TEXT,
  remote_dependency_level TEXT,
  confidence NUMERIC(4,3),
  source TEXT NOT NULL DEFAULT 'unknown',
  user_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  inferred_by TEXT,
  last_verified_at TIMESTAMPTZ,
  stale_at TIMESTAMPTZ,
  review_status TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_workforce_profile_hiring_markets_array
    CHECK (jsonb_typeof(hiring_markets) = 'array'),
  CONSTRAINT company_workforce_profile_key_skills_array
    CHECK (jsonb_typeof(key_skill_dependencies) = 'array'),
  CONSTRAINT company_workforce_profile_contractor_valid
    CHECK (contractor_dependency_level IS NULL OR contractor_dependency_level IN ('none', 'low', 'medium', 'high', 'critical', 'unknown')),
  CONSTRAINT company_workforce_profile_immigration_valid
    CHECK (immigration_dependency_level IS NULL OR immigration_dependency_level IN ('none', 'low', 'medium', 'high', 'critical', 'unknown')),
  CONSTRAINT company_workforce_profile_labor_valid
    CHECK (labor_sensitivity_level IS NULL OR labor_sensitivity_level IN ('low', 'medium', 'high', 'critical', 'unknown')),
  CONSTRAINT company_workforce_profile_remote_valid
    CHECK (remote_dependency_level IS NULL OR remote_dependency_level IN ('none', 'low', 'medium', 'high', 'critical', 'unknown')),
  CONSTRAINT company_workforce_profile_confidence_valid
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT company_workforce_profile_source_valid
    CHECK (source IN ('user', 'ai_inferred', 'integration', 'import', 'system', 'unknown')),
  CONSTRAINT company_workforce_profile_review_status_valid
    CHECK (review_status IN ('missing', 'unknown', 'inferred', 'user_confirmed', 'stale', 'needs_review'))
);

CREATE TABLE IF NOT EXISTS company_technology_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider_name TEXT,
  provider_category TEXT,
  criticality TEXT,
  spend_sensitivity TEXT,
  operational_dependency TEXT,
  notes TEXT,
  confidence NUMERIC(4,3),
  source TEXT NOT NULL DEFAULT 'unknown',
  user_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  inferred_by TEXT,
  last_verified_at TIMESTAMPTZ,
  stale_at TIMESTAMPTZ,
  review_status TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_technology_dependencies_criticality_valid
    CHECK (criticality IS NULL OR criticality IN ('low', 'medium', 'high', 'critical', 'unknown')),
  CONSTRAINT company_technology_dependencies_spend_valid
    CHECK (spend_sensitivity IS NULL OR spend_sensitivity IN ('low', 'medium', 'high', 'critical', 'unknown')),
  CONSTRAINT company_technology_dependencies_confidence_valid
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT company_technology_dependencies_source_valid
    CHECK (source IN ('user', 'ai_inferred', 'integration', 'import', 'system', 'unknown')),
  CONSTRAINT company_technology_dependencies_review_status_valid
    CHECK (review_status IN ('missing', 'unknown', 'inferred', 'user_confirmed', 'stale', 'needs_review'))
);

CREATE INDEX IF NOT EXISTS idx_company_technology_dependencies_company
  ON company_technology_dependencies(company_id, provider_category, updated_at DESC);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'company_revenue_segments',
    'company_geographic_exposures',
    'company_dependencies',
    'company_regulatory_exposures',
    'company_workforce_profile',
    'company_technology_dependencies'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || t || '_updated_at', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at()',
      'trg_' || t || '_updated_at',
      t
    );
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND policyname = 'service_role_full_access'
    ) THEN
      EXECUTE format('DROP POLICY "service_role_full_access" ON public.%I', t);
    END IF;

    EXECUTE format(
      'CREATE POLICY "service_role_full_access" ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      t
    );
  END LOOP;
END $$;

COMMENT ON TABLE company_revenue_segments IS 'Normalized company customer/revenue exposure entities for future relevance and dependency-aware intelligence.';
COMMENT ON TABLE company_geographic_exposures IS 'Normalized geographic exposure entities by exposure type: revenue, operations, workforce, customers, vendors.';
COMMENT ON TABLE company_dependencies IS 'Normalized operational dependency entities for vendor, supplier, labor, platform, channel, and regulatory dependency modeling.';
COMMENT ON TABLE company_regulatory_exposures IS 'Normalized regulation and jurisdiction exposure entities.';
COMMENT ON TABLE company_workforce_profile IS 'Company-level workforce, hiring, immigration, and labor sensitivity profile.';
COMMENT ON TABLE company_technology_dependencies IS 'Normalized technology, cloud, AI, platform, security, and vendor dependency entities.';

COMMIT;
