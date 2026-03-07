-- =====================================================
-- Company Intelligence Configuration (Phase-3)
-- Company-level config for query builder placeholders:
-- {topic}, {competitor}, {product}, {region}, {keyword}
-- =====================================================
-- Run after: companies.sql, governance_add_updated_at.sql (for set_updated_at_timestamp)
-- =====================================================

-- company_intelligence_topics
CREATE TABLE IF NOT EXISTS company_intelligence_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS index_company_intelligence_topics_company_enabled
  ON company_intelligence_topics (company_id, enabled);

-- company_intelligence_competitors
CREATE TABLE IF NOT EXISTS company_intelligence_competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  competitor_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS index_company_intelligence_competitors_company_enabled
  ON company_intelligence_competitors (company_id, enabled);

-- company_intelligence_products
CREATE TABLE IF NOT EXISTS company_intelligence_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS index_company_intelligence_products_company_enabled
  ON company_intelligence_products (company_id, enabled);

-- company_intelligence_regions
CREATE TABLE IF NOT EXISTS company_intelligence_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS index_company_intelligence_regions_company_enabled
  ON company_intelligence_regions (company_id, enabled);

-- company_intelligence_keywords
CREATE TABLE IF NOT EXISTS company_intelligence_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS index_company_intelligence_keywords_company_enabled
  ON company_intelligence_keywords (company_id, enabled);

-- Triggers (reuse set_updated_at_timestamp from Phase-2)
DROP TRIGGER IF EXISTS company_intelligence_topics_updated_at ON company_intelligence_topics;
CREATE TRIGGER company_intelligence_topics_updated_at
BEFORE UPDATE ON company_intelligence_topics
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS company_intelligence_competitors_updated_at ON company_intelligence_competitors;
CREATE TRIGGER company_intelligence_competitors_updated_at
BEFORE UPDATE ON company_intelligence_competitors
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS company_intelligence_products_updated_at ON company_intelligence_products;
CREATE TRIGGER company_intelligence_products_updated_at
BEFORE UPDATE ON company_intelligence_products
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS company_intelligence_regions_updated_at ON company_intelligence_regions;
CREATE TRIGGER company_intelligence_regions_updated_at
BEFORE UPDATE ON company_intelligence_regions
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS company_intelligence_keywords_updated_at ON company_intelligence_keywords;
CREATE TRIGGER company_intelligence_keywords_updated_at
BEFORE UPDATE ON company_intelligence_keywords
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
