BEGIN;

-- Canonical Intelligence Data Model + Decision Object System
-- Additive only: existing tables remain available while new modules converge
-- on canonical_* tables plus decision_objects.

-- ---------------------------------------------------------------------------
-- 0. Reuse existing core entities where safe
-- ---------------------------------------------------------------------------

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS website_domain TEXT;

COMMENT ON COLUMN companies.website_domain IS
  'Canonical company root domain for intelligence joins. Prefer this (or canonical_company_entities.domain) over legacy website/admin_email_domain parsing.';

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS channel TEXT,
  ADD COLUMN IF NOT EXISTS budget NUMERIC(12,2);

COMMENT ON COLUMN campaigns.channel IS
  'Canonical acquisition/execution channel for intelligence attribution (google_ads, linkedin, email, organic_social, etc.). Null only for legacy campaigns not yet backfilled.';

COMMENT ON COLUMN campaigns.budget IS
  'Canonical campaign budget used by decision objects and revenue attribution. Null only for legacy campaigns not yet backfilled.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'campaigns_budget_non_negative'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_budget_non_negative
      CHECK (budget IS NULL OR budget >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_id_company_id
  ON campaigns(id, company_id);

-- ---------------------------------------------------------------------------
-- 1. Shared trigger helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION omnivyra_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Canonical entities
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS canonical_domains (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  primary_domain TEXT        NOT NULL,
  verified       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_domains_domain_not_blank
    CHECK (LENGTH(BTRIM(primary_domain)) > 0),
  CONSTRAINT canonical_domains_domain_lowercase
    CHECK (primary_domain = LOWER(primary_domain)),
  CONSTRAINT canonical_domains_company_domain_unique
    UNIQUE (company_id, primary_domain)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_domains_id_company
  ON canonical_domains(id, company_id);

CREATE INDEX IF NOT EXISTS idx_canonical_domains_company_verified
  ON canonical_domains(company_id, verified DESC, created_at ASC);

COMMENT ON TABLE canonical_domains IS
  'Canonical domain entity. One company may own multiple verified or unverified domains. primary_domain stores the normalized host only.';

CREATE TABLE IF NOT EXISTS canonical_pages (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  domain_id      UUID        NOT NULL,
  url            TEXT        NOT NULL,
  page_type      TEXT        NOT NULL,
  content_vector JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_pages_url_not_blank
    CHECK (LENGTH(BTRIM(url)) > 0),
  CONSTRAINT canonical_pages_page_type_valid
    CHECK (page_type IN ('home', 'landing', 'blog', 'product', 'pricing', 'feature', 'docs', 'contact', 'other')),
  CONSTRAINT canonical_pages_company_url_unique
    UNIQUE (company_id, url),
  CONSTRAINT canonical_pages_domain_fk
    FOREIGN KEY (domain_id, company_id)
    REFERENCES canonical_domains(id, company_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_pages_id_company
  ON canonical_pages(id, company_id);

CREATE INDEX IF NOT EXISTS idx_canonical_pages_company_page_type
  ON canonical_pages(company_id, page_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_pages_domain
  ON canonical_pages(domain_id, created_at DESC);

COMMENT ON TABLE canonical_pages IS
  'Canonical page entity used by Snapshot, Growth, and Deep reporting. content_vector is reserved for embedding payloads or vector references during later rollout.';

CREATE TABLE IF NOT EXISTS canonical_sessions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  domain_id   UUID        NOT NULL,
  source      TEXT        NOT NULL,
  device      TEXT        NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_sessions_source_valid
    CHECK (source IN ('organic', 'paid', 'social', 'direct', 'referral', 'email', 'unknown')),
  CONSTRAINT canonical_sessions_device_valid
    CHECK (device IN ('desktop', 'mobile', 'tablet', 'unknown')),
  CONSTRAINT canonical_sessions_domain_fk
    FOREIGN KEY (domain_id, company_id)
    REFERENCES canonical_domains(id, company_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_sessions_id_company
  ON canonical_sessions(id, company_id);

CREATE INDEX IF NOT EXISTS idx_canonical_sessions_company_source_started
  ON canonical_sessions(company_id, source, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_sessions_domain_started
  ON canonical_sessions(domain_id, started_at DESC);

COMMENT ON TABLE canonical_sessions IS
  'Canonical session entity. Source and device are constrained to query-friendly enumerations for reporting and decision attribution.';

CREATE TABLE IF NOT EXISTS canonical_users (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  session_id  UUID,
  user_type   TEXT        NOT NULL,
  geo         TEXT,
  device      TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_users_user_type_valid
    CHECK (user_type IN ('anonymous', 'known')),
  CONSTRAINT canonical_users_device_valid
    CHECK (device IN ('desktop', 'mobile', 'tablet', 'unknown')),
  CONSTRAINT canonical_users_session_fk
    FOREIGN KEY (session_id, company_id)
    REFERENCES canonical_sessions(id, company_id)
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_users_id_company
  ON canonical_users(id, company_id);

CREATE INDEX IF NOT EXISTS idx_canonical_users_company_user_type
  ON canonical_users(company_id, user_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_users_session
  ON canonical_users(session_id);

COMMENT ON TABLE canonical_users IS
  'Canonical visitor/user entity. Distinct from auth users; used for anonymous and known behavior joins.';

CREATE TABLE IF NOT EXISTS canonical_page_views (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  page_id     UUID        NOT NULL,
  session_id  UUID        NOT NULL,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_page_views_page_fk
    FOREIGN KEY (page_id, company_id)
    REFERENCES canonical_pages(id, company_id)
    ON DELETE CASCADE,
  CONSTRAINT canonical_page_views_session_fk
    FOREIGN KEY (session_id, company_id)
    REFERENCES canonical_sessions(id, company_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canonical_page_views_company_viewed_at
  ON canonical_page_views(company_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_page_views_page
  ON canonical_page_views(page_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_page_views_session
  ON canonical_page_views(session_id, viewed_at ASC);

COMMENT ON TABLE canonical_page_views IS
  'Join table that makes Page -> Session queryable for funnel, drop-off, and path analysis.';

CREATE TABLE IF NOT EXISTS canonical_leads (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id             UUID         NOT NULL,
  source              TEXT         NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  qualification_score NUMERIC(5,2) NOT NULL DEFAULT 0,

  CONSTRAINT canonical_leads_source_not_blank
    CHECK (LENGTH(BTRIM(source)) > 0),
  CONSTRAINT canonical_leads_qualification_score_valid
    CHECK (qualification_score >= 0 AND qualification_score <= 100),
  CONSTRAINT canonical_leads_user_fk
    FOREIGN KEY (user_id, company_id)
    REFERENCES canonical_users(id, company_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_leads_id_company
  ON canonical_leads(id, company_id);

CREATE INDEX IF NOT EXISTS idx_canonical_leads_company_source_created
  ON canonical_leads(company_id, source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_leads_user
  ON canonical_leads(user_id);

COMMENT ON TABLE canonical_leads IS
  'Canonical lead entity linked to canonical_users. qualification_score is constrained to 0-100 to match downstream scoring and filtering.';

CREATE TABLE IF NOT EXISTS canonical_revenue_events (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID          NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lead_id         UUID          NOT NULL,
  campaign_id     UUID,
  revenue_amount  NUMERIC(12,2) NOT NULL,
  conversion_type TEXT          NOT NULL,
  currency_code   CHAR(3)       NOT NULL DEFAULT 'USD',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_revenue_events_amount_non_negative
    CHECK (revenue_amount >= 0),
  CONSTRAINT canonical_revenue_events_conversion_type_not_blank
    CHECK (LENGTH(BTRIM(conversion_type)) > 0),
  CONSTRAINT canonical_revenue_events_currency_uppercase
    CHECK (currency_code = UPPER(currency_code)),
  CONSTRAINT canonical_revenue_events_lead_fk
    FOREIGN KEY (lead_id, company_id)
    REFERENCES canonical_leads(id, company_id)
    ON DELETE CASCADE,
  CONSTRAINT canonical_revenue_events_campaign_fk
    FOREIGN KEY (campaign_id, company_id)
    REFERENCES campaigns(id, company_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_canonical_revenue_events_company_created
  ON canonical_revenue_events(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_revenue_events_lead
  ON canonical_revenue_events(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_revenue_events_campaign
  ON canonical_revenue_events(campaign_id, created_at DESC)
  WHERE campaign_id IS NOT NULL;

COMMENT ON TABLE canonical_revenue_events IS
  'Canonical revenue attribution entity. Supports direct lead-to-revenue joins and optional campaign attribution.';

-- ---------------------------------------------------------------------------
-- 3. Decision object core
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS decision_objects (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type       TEXT         NOT NULL,
  entity_id         UUID,
  issue_type        TEXT         NOT NULL,
  title             TEXT         NOT NULL,
  description       TEXT         NOT NULL,
  evidence          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  impact_traffic    SMALLINT     NOT NULL,
  impact_conversion SMALLINT     NOT NULL,
  impact_revenue    SMALLINT     NOT NULL,
  confidence_score  NUMERIC(4,3) NOT NULL,
  recommendation    TEXT         NOT NULL,
  action_type       TEXT         NOT NULL,
  status            TEXT         NOT NULL DEFAULT 'open',
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  ignored_at        TIMESTAMPTZ,

  CONSTRAINT decision_objects_entity_type_valid
    CHECK (entity_type IN ('page', 'session', 'campaign', 'global')),
  CONSTRAINT decision_objects_status_valid
    CHECK (status IN ('open', 'resolved', 'ignored')),
  CONSTRAINT decision_objects_issue_type_not_blank
    CHECK (LENGTH(BTRIM(issue_type)) > 0),
  CONSTRAINT decision_objects_action_type_not_blank
    CHECK (LENGTH(BTRIM(action_type)) > 0),
  CONSTRAINT decision_objects_title_not_blank
    CHECK (LENGTH(BTRIM(title)) > 0),
  CONSTRAINT decision_objects_description_not_blank
    CHECK (LENGTH(BTRIM(description)) > 0),
  CONSTRAINT decision_objects_recommendation_not_blank
    CHECK (LENGTH(BTRIM(recommendation)) > 0),
  CONSTRAINT decision_objects_impact_traffic_valid
    CHECK (impact_traffic BETWEEN 0 AND 100),
  CONSTRAINT decision_objects_impact_conversion_valid
    CHECK (impact_conversion BETWEEN 0 AND 100),
  CONSTRAINT decision_objects_impact_revenue_valid
    CHECK (impact_revenue BETWEEN 0 AND 100),
  CONSTRAINT decision_objects_confidence_valid
    CHECK (confidence_score >= 0 AND confidence_score <= 1),
  CONSTRAINT decision_objects_global_entity_shape
    CHECK (
      (entity_type = 'global' AND entity_id IS NULL) OR
      (entity_type <> 'global' AND entity_id IS NOT NULL)
    ),
  CONSTRAINT decision_objects_evidence_shape
    CHECK (jsonb_typeof(evidence) IN ('object', 'array'))
);

CREATE INDEX IF NOT EXISTS idx_decision_objects_company_status_created
  ON decision_objects(company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_objects_company_entity
  ON decision_objects(company_id, entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_objects_company_issue_type
  ON decision_objects(company_id, issue_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_objects_company_action_type
  ON decision_objects(company_id, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_objects_company_impact
  ON decision_objects(company_id, impact_revenue DESC, impact_conversion DESC, impact_traffic DESC);

CREATE INDEX IF NOT EXISTS idx_decision_objects_evidence_gin
  ON decision_objects
  USING GIN(evidence);

COMMENT ON TABLE decision_objects IS
  'Canonical intelligence contract. Every future issue must resolve to: Issue -> Evidence -> Impact -> Confidence -> Recommendation -> Action.';

COMMENT ON COLUMN decision_objects.evidence IS
  'Structured JSON evidence only. Store source metrics, page/session facts, excerpts, or trace data required to justify the decision.';

CREATE OR REPLACE FUNCTION omnivyra_validate_decision_object_entity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.entity_type = 'global' THEN
    IF NEW.entity_id IS NOT NULL THEN
      RAISE EXCEPTION 'Global decision objects must not include entity_id';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.entity_id IS NULL THEN
    RAISE EXCEPTION 'Non-global decision objects must include entity_id';
  END IF;

  IF NEW.entity_type = 'page' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM canonical_pages p
      WHERE p.id = NEW.entity_id
        AND p.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'Decision object entity_id % is not a page in company %', NEW.entity_id, NEW.company_id;
    END IF;
  ELSIF NEW.entity_type = 'session' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM canonical_sessions s
      WHERE s.id = NEW.entity_id
        AND s.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'Decision object entity_id % is not a session in company %', NEW.entity_id, NEW.company_id;
    END IF;
  ELSIF NEW.entity_type = 'campaign' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM campaigns c
      WHERE c.id = NEW.entity_id
        AND c.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'Decision object entity_id % is not a campaign in company %', NEW.entity_id, NEW.company_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_decision_objects_validate_entity ON decision_objects;
CREATE TRIGGER trg_decision_objects_validate_entity
  BEFORE INSERT OR UPDATE ON decision_objects
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_validate_decision_object_entity();

-- ---------------------------------------------------------------------------
-- 4. Updated_at triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_canonical_domains_updated_at ON canonical_domains;
CREATE TRIGGER trg_canonical_domains_updated_at
  BEFORE UPDATE ON canonical_domains
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS trg_canonical_pages_updated_at ON canonical_pages;
CREATE TRIGGER trg_canonical_pages_updated_at
  BEFORE UPDATE ON canonical_pages
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS trg_decision_objects_updated_at ON decision_objects;
CREATE TRIGGER trg_decision_objects_updated_at
  BEFORE UPDATE ON decision_objects
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Compatibility / mapping layer
-- ---------------------------------------------------------------------------

INSERT INTO canonical_domains (company_id, primary_domain, verified)
SELECT DISTINCT
  cd.company_id,
  LOWER(BTRIM(cd.domain)),
  COALESCE(cd.verified, FALSE)
FROM company_domains cd
WHERE cd.domain IS NOT NULL
  AND BTRIM(cd.domain) <> ''
ON CONFLICT (company_id, primary_domain) DO NOTHING;

INSERT INTO canonical_domains (company_id, primary_domain, verified)
SELECT
  c.id,
  LOWER(BTRIM(c.website_domain)),
  FALSE
FROM companies c
WHERE c.website_domain IS NOT NULL
  AND BTRIM(c.website_domain) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM canonical_domains d
    WHERE d.company_id = c.id
      AND d.primary_domain = LOWER(BTRIM(c.website_domain))
  );

CREATE OR REPLACE VIEW canonical_company_entities AS
SELECT
  c.id,
  c.name,
  COALESCE(
    preferred.primary_domain,
    NULLIF(BTRIM(c.website_domain), '')
  ) AS domain,
  c.created_at
FROM companies c
LEFT JOIN LATERAL (
  SELECT d.primary_domain
  FROM canonical_domains d
  WHERE d.company_id = c.id
  ORDER BY d.verified DESC, d.created_at ASC
  LIMIT 1
) preferred ON TRUE;

COMMENT ON VIEW canonical_company_entities IS
  'Mapping view exposing the canonical company shape (id, name, domain, created_at) without breaking existing companies/company_domains usage.';

CREATE OR REPLACE VIEW canonical_campaign_entities AS
SELECT
  c.id,
  c.company_id,
  c.channel,
  c.budget,
  c.start_date,
  c.end_date
FROM campaigns c;

COMMENT ON VIEW canonical_campaign_entities IS
  'Mapping view exposing the canonical campaign shape while existing code continues to read/write campaigns directly.';

-- ---------------------------------------------------------------------------
-- 6. Deprecation markers for legacy intelligence write paths
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  legacy_tables TEXT[] := ARRAY[
    'engagement_insights',
    'campaign_strategic_insights',
    'campaign_health_reports',
    'company_intelligence_signals',
    'intelligence_signals',
    'recommendation_snapshots',
    'opportunity_reports'
  ];
BEGIN
  FOREACH t IN ARRAY legacy_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = t
        AND c.relkind = 'r'
    ) THEN
      EXECUTE format(
        'COMMENT ON TABLE public.%I IS %L',
        t,
        'DEPRECATED FOR NEW INTELLIGENCE WRITES: preserve for backward compatibility only. New issues/recommendations/actions must be written through decision_objects plus canonical_* entities.'
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7. RLS and service-role-only access, aligned with current platform policy
-- ---------------------------------------------------------------------------

ALTER TABLE canonical_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_revenue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_objects ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  protected_tables TEXT[] := ARRAY[
    'canonical_domains',
    'canonical_pages',
    'canonical_sessions',
    'canonical_users',
    'canonical_page_views',
    'canonical_leads',
    'canonical_revenue_events',
    'decision_objects'
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
