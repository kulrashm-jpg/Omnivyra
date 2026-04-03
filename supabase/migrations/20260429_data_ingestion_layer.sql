BEGIN;

ALTER TABLE data_source_status
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE canonical_pages
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS meta_title TEXT,
  ADD COLUMN IF NOT EXISTS meta_description TEXT,
  ADD COLUMN IF NOT EXISTS headings JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ctas JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS internal_link_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_crawled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS crawl_depth INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS http_status INTEGER,
  ADD COLUMN IF NOT EXISTS crawl_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE canonical_sessions
  ADD COLUMN IF NOT EXISTS external_session_key TEXT,
  ADD COLUMN IF NOT EXISTS session_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_medium TEXT,
  ADD COLUMN IF NOT EXISTS source_campaign TEXT,
  ADD COLUMN IF NOT EXISTS geo_country TEXT,
  ADD COLUMN IF NOT EXISTS geo_region TEXT,
  ADD COLUMN IF NOT EXISTS geo_city TEXT,
  ADD COLUMN IF NOT EXISTS engagement_time_msec BIGINT,
  ADD COLUMN IF NOT EXISTS is_engaged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS page_view_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE canonical_users
  ADD COLUMN IF NOT EXISTS external_user_key TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS user_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE canonical_page_views
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS engagement_time_msec BIGINT,
  ADD COLUMN IF NOT EXISTS view_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE canonical_leads
  ADD COLUMN IF NOT EXISTS external_lead_key TEXT,
  ADD COLUMN IF NOT EXISTS lead_status TEXT,
  ADD COLUMN IF NOT EXISTS lead_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE canonical_revenue_events
  ADD COLUMN IF NOT EXISTS external_revenue_key TEXT,
  ADD COLUMN IF NOT EXISTS revenue_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS external_campaign_key TEXT,
  ADD COLUMN IF NOT EXISTS source_platform TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_sessions_company_external
  ON canonical_sessions(company_id, external_session_key)
  WHERE external_session_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_users_company_external
  ON canonical_users(company_id, external_user_key)
  WHERE external_user_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_leads_company_external
  ON canonical_leads(company_id, external_lead_key)
  WHERE external_lead_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_revenue_company_external
  ON canonical_revenue_events(company_id, external_revenue_key)
  WHERE external_revenue_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_company_external_key
  ON campaigns(company_id, external_campaign_key)
  WHERE external_campaign_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS page_content (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  page_id       UUID        NOT NULL,
  block_index   INTEGER     NOT NULL,
  block_type    TEXT        NOT NULL,
  heading_level SMALLINT,
  content_text  TEXT,
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT page_content_page_fk
    FOREIGN KEY (page_id, company_id)
    REFERENCES canonical_pages(id, company_id)
    ON DELETE CASCADE,
  CONSTRAINT page_content_block_type_valid
    CHECK (block_type IN ('heading', 'paragraph', 'list', 'cta', 'other')),
  CONSTRAINT page_content_heading_level_valid
    CHECK (heading_level IS NULL OR heading_level BETWEEN 1 AND 6),
  CONSTRAINT page_content_company_page_index_unique
    UNIQUE (company_id, page_id, block_index)
);

CREATE INDEX IF NOT EXISTS idx_page_content_company_page
  ON page_content(company_id, page_id, block_index ASC);

DROP TRIGGER IF EXISTS trg_page_content_updated_at ON page_content;
CREATE TRIGGER trg_page_content_updated_at
  BEFORE UPDATE ON page_content
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

CREATE TABLE IF NOT EXISTS page_links (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_page_id   UUID        NOT NULL,
  to_page_id     UUID,
  to_url         TEXT        NOT NULL,
  anchor_text    TEXT,
  is_internal    BOOLEAN     NOT NULL DEFAULT FALSE,
  position_index INTEGER     NOT NULL DEFAULT 0,
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT page_links_from_page_fk
    FOREIGN KEY (from_page_id, company_id)
    REFERENCES canonical_pages(id, company_id)
    ON DELETE CASCADE,
  CONSTRAINT page_links_to_page_fk
    FOREIGN KEY (to_page_id, company_id)
    REFERENCES canonical_pages(id, company_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_page_links_company_from_page
  ON page_links(company_id, from_page_id, position_index ASC);

CREATE INDEX IF NOT EXISTS idx_page_links_company_to_url
  ON page_links(company_id, to_url);

DROP TRIGGER IF EXISTS trg_page_links_updated_at ON page_links;
CREATE TRIGGER trg_page_links_updated_at
  BEFORE UPDATE ON page_links
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

CREATE TABLE IF NOT EXISTS canonical_keywords (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  keyword            TEXT        NOT NULL,
  keyword_normalized TEXT        NOT NULL,
  landing_page_url   TEXT        NOT NULL DEFAULT '',
  source             TEXT        NOT NULL DEFAULT 'gsc',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_keywords_keyword_not_blank
    CHECK (LENGTH(BTRIM(keyword)) > 0),
  CONSTRAINT canonical_keywords_source_valid
    CHECK (source IN ('gsc', 'manual', 'seo_tool', 'other')),
  CONSTRAINT canonical_keywords_company_unique
    UNIQUE (company_id, keyword_normalized, landing_page_url)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_keywords_id_company
  ON canonical_keywords(id, company_id);

CREATE INDEX IF NOT EXISTS idx_canonical_keywords_company_keyword
  ON canonical_keywords(company_id, keyword_normalized, created_at DESC);

DROP TRIGGER IF EXISTS trg_canonical_keywords_updated_at ON canonical_keywords;
CREATE TRIGGER trg_canonical_keywords_updated_at
  BEFORE UPDATE ON canonical_keywords
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

CREATE TABLE IF NOT EXISTS keyword_metrics (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  keyword_id       UUID         NOT NULL,
  metric_date      DATE         NOT NULL,
  page_url         TEXT         NOT NULL DEFAULT '',
  impressions      BIGINT       NOT NULL DEFAULT 0,
  clicks           BIGINT       NOT NULL DEFAULT 0,
  ctr              NUMERIC(8,4) NOT NULL DEFAULT 0,
  avg_position     NUMERIC(10,4),
  dimension_values JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT keyword_metrics_keyword_fk
    FOREIGN KEY (keyword_id, company_id)
    REFERENCES canonical_keywords(id, company_id)
    ON DELETE CASCADE,
  CONSTRAINT keyword_metrics_ctr_valid
    CHECK (ctr >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_keyword_metrics_company_unique
  ON keyword_metrics(company_id, keyword_id, metric_date, page_url);

CREATE INDEX IF NOT EXISTS idx_keyword_metrics_company_date
  ON keyword_metrics(company_id, metric_date DESC);

DROP TRIGGER IF EXISTS trg_keyword_metrics_updated_at ON keyword_metrics;
CREATE TRIGGER trg_keyword_metrics_updated_at
  BEFORE UPDATE ON keyword_metrics
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

CREATE TABLE IF NOT EXISTS campaign_metrics (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID          NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id          UUID          REFERENCES campaigns(id) ON DELETE SET NULL,
  external_campaign_key TEXT        NOT NULL DEFAULT '',
  platform             TEXT          NOT NULL,
  metric_date          DATE          NOT NULL,
  impressions          BIGINT        NOT NULL DEFAULT 0,
  clicks               BIGINT        NOT NULL DEFAULT 0,
  conversions          BIGINT        NOT NULL DEFAULT 0,
  spend                NUMERIC(12,2) NOT NULL DEFAULT 0,
  revenue_amount       NUMERIC(12,2),
  currency_code        CHAR(3)       NOT NULL DEFAULT 'USD',
  metrics_metadata     JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT campaign_metrics_currency_uppercase
    CHECK (currency_code = UPPER(currency_code))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_metrics_company_unique
  ON campaign_metrics(company_id, external_campaign_key, platform, metric_date);

CREATE INDEX IF NOT EXISTS idx_campaign_metrics_company_date
  ON campaign_metrics(company_id, metric_date DESC);

DROP TRIGGER IF EXISTS trg_campaign_metrics_updated_at ON campaign_metrics;
CREATE TRIGGER trg_campaign_metrics_updated_at
  BEFORE UPDATE ON campaign_metrics
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source            TEXT        NOT NULL,
  idempotency_key   TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'running',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  records_processed INTEGER     NOT NULL DEFAULT 0,
  records_inserted  INTEGER     NOT NULL DEFAULT 0,
  records_updated   INTEGER     NOT NULL DEFAULT 0,
  retry_count       INTEGER     NOT NULL DEFAULT 0,
  cursor_payload    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ingestion_runs_source_valid
    CHECK (source IN ('crawler', 'ga4', 'gsc', 'crm', 'ads')),
  CONSTRAINT ingestion_runs_status_valid
    CHECK (status IN ('running', 'completed', 'failed', 'partial', 'skipped')),
  CONSTRAINT ingestion_runs_idempotency_not_blank
    CHECK (LENGTH(BTRIM(idempotency_key)) > 0),
  CONSTRAINT ingestion_runs_company_source_key_unique
    UNIQUE (company_id, source, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_company_source_started
  ON ingestion_runs(company_id, source, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_company_status
  ON ingestion_runs(company_id, status, started_at DESC);

DROP TRIGGER IF EXISTS trg_ingestion_runs_updated_at ON ingestion_runs;
CREATE TRIGGER trg_ingestion_runs_updated_at
  BEFORE UPDATE ON ingestion_runs
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

ALTER TABLE page_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_runs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  protected_tables TEXT[] := ARRAY[
    'page_content',
    'page_links',
    'canonical_keywords',
    'keyword_metrics',
    'campaign_metrics',
    'ingestion_runs'
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
