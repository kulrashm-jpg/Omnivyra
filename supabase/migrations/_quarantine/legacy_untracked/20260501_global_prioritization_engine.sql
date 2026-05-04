BEGIN;

CREATE TABLE IF NOT EXISTS decision_priority_queue (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  decision_id             UUID        NOT NULL REFERENCES decision_objects(id) ON DELETE CASCADE,
  report_tier             TEXT        NOT NULL,
  priority_score          SMALLINT    NOT NULL,
  priority_rank           INTEGER     NOT NULL,
  score_impact            NUMERIC(6,4) NOT NULL,
  score_confidence        NUMERIC(6,4) NOT NULL,
  score_revenue_linkage   NUMERIC(6,4) NOT NULL,
  score_urgency           NUMERIC(6,4) NOT NULL,
  model_version           TEXT        NOT NULL,
  scored_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT decision_priority_queue_company_decision_unique
    UNIQUE (company_id, decision_id),
  CONSTRAINT decision_priority_queue_report_tier_valid
    CHECK (report_tier IN ('snapshot', 'growth', 'deep')),
  CONSTRAINT decision_priority_queue_priority_score_valid
    CHECK (priority_score BETWEEN 0 AND 100),
  CONSTRAINT decision_priority_queue_priority_rank_valid
    CHECK (priority_rank > 0),
  CONSTRAINT decision_priority_queue_score_impact_valid
    CHECK (score_impact BETWEEN 0 AND 1),
  CONSTRAINT decision_priority_queue_score_confidence_valid
    CHECK (score_confidence BETWEEN 0 AND 1),
  CONSTRAINT decision_priority_queue_score_revenue_linkage_valid
    CHECK (score_revenue_linkage BETWEEN 0 AND 1),
  CONSTRAINT decision_priority_queue_score_urgency_valid
    CHECK (score_urgency BETWEEN 0 AND 1),
  CONSTRAINT decision_priority_queue_model_version_not_blank
    CHECK (LENGTH(BTRIM(model_version)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_decision_priority_queue_company_rank
  ON decision_priority_queue(company_id, priority_rank ASC);

CREATE INDEX IF NOT EXISTS idx_decision_priority_queue_company_tier_rank
  ON decision_priority_queue(company_id, report_tier, priority_rank ASC);

CREATE INDEX IF NOT EXISTS idx_decision_priority_queue_company_scored_at
  ON decision_priority_queue(company_id, scored_at DESC);

DROP TRIGGER IF EXISTS trg_decision_priority_queue_updated_at ON decision_priority_queue;
CREATE TRIGGER trg_decision_priority_queue_updated_at
  BEFORE UPDATE ON decision_priority_queue
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

COMMENT ON TABLE decision_priority_queue IS
  'Global ranked decision queue across all intelligence engines per company.';

COMMENT ON COLUMN decision_priority_queue.model_version IS
  'Prioritization model identifier used to compute this rank.';

COMMIT;
