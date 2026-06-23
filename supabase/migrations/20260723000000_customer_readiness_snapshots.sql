-- customer_readiness_snapshots
-- Daily READ-ONLY snapshot of the Customer Readiness model per company, enabling the
-- Evolution engine (Phase 12H). Additive + isolated: a new table, no alters to existing
-- tables, no FKs. Safe to apply; reversible by DROP TABLE.
--
-- Idempotency: one snapshot per company per day (unique on company_id + snapshot_date).

CREATE TABLE IF NOT EXISTS public.customer_readiness_snapshots (
  snapshot_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid        NOT NULL,
  taken_at                 timestamptz NOT NULL DEFAULT now(),
  snapshot_date            date        NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,

  tenant_status            text        NOT NULL,
  overall_readiness_score  integer     NOT NULL,
  readiness_bucket         text        NOT NULL,

  priority_score           integer     NOT NULL DEFAULT 0,
  priority_tier            text        NOT NULL,

  opportunity_count        integer     NOT NULL DEFAULT 0,

  company_profile_ready    text        NOT NULL,
  website_ready            text        NOT NULL,
  ga_ready                 text        NOT NULL,
  gsc_ready                text        NOT NULL,
  social_ready             text        NOT NULL,
  community_ready          text        NOT NULL,
  team_ready               text        NOT NULL,
  billing_ready            text        NOT NULL,

  snapshot_version         text        NOT NULL DEFAULT 'readiness-snapshot-v1'
);

-- One snapshot per company per day → rerun-safe daily job.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crs_company_day
  ON public.customer_readiness_snapshots (company_id, snapshot_date);

-- Fast "latest snapshots per company" reads for the evolution engine.
CREATE INDEX IF NOT EXISTS idx_crs_company_taken
  ON public.customer_readiness_snapshots (company_id, taken_at DESC);
