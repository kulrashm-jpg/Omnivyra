BEGIN;

CREATE TABLE IF NOT EXISTS canonical_backlink_signals (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  target_url        TEXT        NOT NULL,
  referring_domain  TEXT        NOT NULL,
  anchor_text       TEXT,
  domain_authority  NUMERIC(5,2),
  link_type         TEXT        NOT NULL DEFAULT 'dofollow',
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detected_source   TEXT        NOT NULL DEFAULT 'manual',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_backlink_signals_target_url_not_blank
    CHECK (LENGTH(BTRIM(target_url)) > 0),
  CONSTRAINT canonical_backlink_signals_referring_domain_not_blank
    CHECK (LENGTH(BTRIM(referring_domain)) > 0),
  CONSTRAINT canonical_backlink_signals_link_type_valid
    CHECK (link_type IN ('dofollow', 'nofollow', 'ugc', 'sponsored')),
  CONSTRAINT canonical_backlink_signals_domain_authority_valid
    CHECK (domain_authority IS NULL OR (domain_authority >= 0 AND domain_authority <= 100))
);

CREATE INDEX IF NOT EXISTS idx_canonical_backlink_signals_company_seen
  ON canonical_backlink_signals(company_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_backlink_signals_company_referring
  ON canonical_backlink_signals(company_id, referring_domain);

CREATE INDEX IF NOT EXISTS idx_canonical_backlink_signals_company_target
  ON canonical_backlink_signals(company_id, target_url);

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_backlink_signals_unique_link
  ON canonical_backlink_signals(company_id, target_url, referring_domain, COALESCE(anchor_text, ''));

DROP TRIGGER IF EXISTS trg_canonical_backlink_signals_updated_at ON canonical_backlink_signals;
CREATE TRIGGER trg_canonical_backlink_signals_updated_at
  BEFORE UPDATE ON canonical_backlink_signals
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

COMMENT ON TABLE canonical_backlink_signals IS
  'Canonical backlink signal adapter for authority intelligence and backlink profile analysis.';

COMMIT;
