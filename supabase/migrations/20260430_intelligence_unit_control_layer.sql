BEGIN;

CREATE TABLE IF NOT EXISTS intelligence_units (
  id                TEXT        PRIMARY KEY,
  name              TEXT        NOT NULL,
  category          TEXT        NOT NULL,
  decision_types    TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  required_entities TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  cost_weight       NUMERIC(6,2) NOT NULL DEFAULT 1,
  report_tiers      TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intelligence_units_id_format
    CHECK (id ~ '^IU-[0-9]{2}$'),
  CONSTRAINT intelligence_units_name_not_blank
    CHECK (LENGTH(BTRIM(name)) > 0),
  CONSTRAINT intelligence_units_category_not_blank
    CHECK (LENGTH(BTRIM(category)) > 0),
  CONSTRAINT intelligence_units_cost_weight_non_negative
    CHECK (cost_weight >= 0),
  CONSTRAINT intelligence_units_report_tiers_valid
    CHECK (
      report_tiers <@ ARRAY['snapshot', 'growth', 'deep']::TEXT[]
    )
);

CREATE TABLE IF NOT EXISTS company_intelligence_config (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  iu_id             TEXT        NOT NULL REFERENCES intelligence_units(id) ON DELETE CASCADE,
  enabled           BOOLEAN     NOT NULL DEFAULT TRUE,
  priority_override INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT company_intelligence_config_priority_valid
    CHECK (priority_override IS NULL OR priority_override BETWEEN 0 AND 100),
  CONSTRAINT company_intelligence_config_company_iu_unique
    UNIQUE (company_id, iu_id)
);

CREATE INDEX IF NOT EXISTS idx_company_intelligence_config_company_enabled
  ON company_intelligence_config(company_id, enabled, iu_id);

DROP TRIGGER IF EXISTS trg_intelligence_units_updated_at ON intelligence_units;
CREATE TRIGGER trg_intelligence_units_updated_at
  BEFORE UPDATE ON intelligence_units
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS trg_company_intelligence_config_updated_at ON company_intelligence_config;
CREATE TRIGGER trg_company_intelligence_config_updated_at
  BEFORE UPDATE ON company_intelligence_config
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

INSERT INTO intelligence_units (
  id,
  name,
  category,
  decision_types,
  required_entities,
  cost_weight,
  report_tiers
)
VALUES
  (
    'IU-01',
    'Traffic Intelligence',
    'traffic',
    ARRAY['low_quality_traffic', 'wrong_geo_traffic', 'channel_mismatch'],
    ARRAY['canonical_sessions', 'canonical_users', 'canonical_page_views'],
    1.25,
    ARRAY['growth', 'deep']
  ),
  (
    'IU-02',
    'Funnel Intelligence',
    'funnel',
    ARRAY['high_dropoff_page', 'weak_conversion_path', 'dead_end_pages'],
    ARRAY['canonical_page_views', 'canonical_pages'],
    1.15,
    ARRAY['deep']
  ),
  (
    'IU-03',
    'SEO Intelligence',
    'seo',
    ARRAY['seo_gap', 'ranking_gap', 'impression_click_gap', 'ranking_opportunity', 'keyword_decay', 'keyword_opportunity'],
    ARRAY['canonical_keywords', 'keyword_metrics'],
    0.95,
    ARRAY['snapshot', 'growth']
  ),
  (
    'IU-04',
    'Content Authority',
    'content',
    ARRAY['topic_gap', 'weak_content_depth', 'missing_cluster_support', 'weak_cluster_depth', 'missing_supporting_content', 'content_gap'],
    ARRAY['canonical_pages', 'page_content', 'page_links'],
    1.1,
    ARRAY['growth', 'deep']
  ),
  (
    'IU-05',
    'Revenue Intelligence',
    'revenue',
    ARRAY['low_quality_lead', 'high_dropoff_lead', 'unqualified_lead_source', 'high_value_source', 'low_conversion_source', 'revenue_leak'],
    ARRAY['canonical_leads', 'canonical_revenue_events', 'leads'],
    1.4,
    ARRAY['deep']
  )
  ),
  (
    'IU-06',
    'Conversion Quality',
    'conversion',
    ARRAY['low_quality_lead', 'high_dropoff_lead', 'unqualified_lead_source', 'high_dropoff_page', 'weak_conversion_path'],
    ARRAY['canonical_leads', 'canonical_revenue_events', 'canonical_page_views', 'canonical_pages'],
    1.3,
    ARRAY['deep']
  ),
  (
    'IU-07',
    'Engagement Depth',
    'engagement',
    ARRAY['low_quality_traffic', 'weak_content_depth', 'missing_cluster_support', 'weak_cluster_depth', 'dead_end_pages'],
    ARRAY['canonical_sessions', 'canonical_pages', 'page_content', 'page_links'],
    1.1,
    ARRAY['growth', 'deep']
  ),
  (
    'IU-08',
    'Behavioral Patterns',
    'behavior',
    ARRAY['channel_mismatch', 'wrong_geo_traffic', 'high_dropoff_lead', 'low_conversion_source'],
    ARRAY['canonical_sessions', 'canonical_leads', 'canonical_revenue_events'],
    1.0,
    ARRAY['growth', 'deep']
  ),
  (
    'IU-09',
    'Channel Effectiveness',
    'channel',
    ARRAY['low_quality_traffic', 'wrong_geo_traffic', 'channel_mismatch', 'unqualified_lead_source', 'low_conversion_source'],
    ARRAY['canonical_sessions', 'canonical_leads', 'canonical_revenue_events'],
    1.2,
    ARRAY['growth', 'deep']
  ),
  (
    'IU-10',
    'Journey Analysis',
    'journey',
    ARRAY['high_dropoff_page', 'dead_end_pages', 'weak_conversion_path', 'revenue_leak'],
    ARRAY['canonical_page_views', 'canonical_pages', 'canonical_leads', 'canonical_revenue_events'],
    1.15,
    ARRAY['deep']
  ),
  (
    'IU-11',
    'Opportunity Signals',
    'opportunity',
    ARRAY['high_value_source', 'ranking_opportunity', 'keyword_opportunity', 'missing_supporting_content', 'topic_gap'],
    ARRAY['canonical_keywords', 'keyword_metrics', 'canonical_leads', 'canonical_pages', 'page_content'],
    1.05,
    ARRAY['growth']
  ),
  (
    'IU-12',
    'Risk Signals',
    'risk',
    ARRAY['low_quality_traffic', 'low_quality_lead', 'keyword_decay', 'seo_gap', 'content_gap'],
    ARRAY['canonical_sessions', 'canonical_keywords', 'keyword_metrics', 'canonical_pages', 'page_content'],
    1.15,
    ARRAY['snapshot', 'growth']
  ),
  (
    'IU-13',
    'Growth Levers',
    'growth',
    ARRAY['ranking_opportunity', 'keyword_opportunity', 'missing_cluster_support', 'missing_supporting_content', 'topic_gap'],
    ARRAY['canonical_keywords', 'keyword_metrics', 'canonical_pages', 'page_content', 'page_links'],
    1.1,
    ARRAY['growth']
  ),
  (
    'IU-14',
    'Efficiency Signals',
    'efficiency',
    ARRAY['high_dropoff_page', 'dead_end_pages', 'channel_mismatch', 'impression_click_gap'],
    ARRAY['canonical_page_views', 'canonical_pages', 'canonical_sessions', 'canonical_keywords', 'keyword_metrics'],
    1.05,
    ARRAY['growth', 'deep']
  ),
  (
    'IU-15',
    'Strategic Insights',
    'strategic',
    ARRAY['seo_gap', 'ranking_gap', 'content_gap', 'high_value_source', 'revenue_leak', 'weak_cluster_depth'],
    ARRAY['canonical_keywords', 'keyword_metrics', 'canonical_pages', 'page_content', 'canonical_leads', 'canonical_revenue_events'],
    1.2,
    ARRAY['snapshot', 'growth', 'deep']
  )
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  decision_types = EXCLUDED.decision_types,
  required_entities = EXCLUDED.required_entities,
  cost_weight = EXCLUDED.cost_weight,
  report_tiers = EXCLUDED.report_tiers,
  updated_at = NOW();

ALTER TABLE intelligence_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_intelligence_config ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  protected_tables TEXT[] := ARRAY[
    'intelligence_units',
    'company_intelligence_config'
  ];
BEGIN
  FOREACH t IN ARRAY protected_tables LOOP
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

COMMIT;
