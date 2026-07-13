-- =============================================================================
-- CSA-001 — Canonical Customer Usage Signal Platform (time-series sink)
--
-- The ONE durable, canonical stream of CUSTOMER PRODUCT USAGE events (in-app
-- actions: login, feature_used, campaign_created, content_published, …). This is
-- the time-series history every future Customer Success capability (Health,
-- Lifecycle, Retention, Risk, Engagement, Adoption) consumes via the usage
-- authority. Raw events ARE the time-series; daily/weekly/monthly aggregation is
-- computed on read from these rows (no rollup table, no rollup job).
--
-- Distinct from, and additive to:
--   - public.blog_analytics   (website-VISITOR analytics via /api/track)
--   - public.usage_events     (BILLING usage → ledger linkage)
-- No existing table is altered; no FK; reversible by DROP TABLE.
--
-- Idempotency (§6): UNIQUE (company_id, event_id). Ingestion inserts with
-- ON CONFLICT DO NOTHING, so retries/replays of the same event never
-- double-count.
--
-- Privacy (§5): only existing identifiers (company_id, user_id) + type/feature/
-- capability + a bounded non-PII metadata bag. No email/name/IP columns.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.customer_usage_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    text        NOT NULL,
  user_id       text,
  event_type    text        NOT NULL,
  feature       text,
  capability    text,
  -- Idempotency key (client/producer-supplied or deterministically derived).
  event_id      text        NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  metadata      jsonb,
  event_day     date        NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date
);

-- §6 — one row per (company, event_id): the dedup anchor for ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cue_company_event
  ON public.customer_usage_events (company_id, event_id);

-- §3/§4 — time-series reads per company over a window (the authority's hot path).
CREATE INDEX IF NOT EXISTS idx_cue_company_time
  ON public.customer_usage_events (company_id, occurred_at DESC);

-- §3 — per-user attribution within a company.
CREATE INDEX IF NOT EXISTS idx_cue_company_user_time
  ON public.customer_usage_events (company_id, user_id, occurred_at DESC);

-- §3 — per-feature / per-capability slicing.
CREATE INDEX IF NOT EXISTS idx_cue_company_feature
  ON public.customer_usage_events (company_id, feature);
CREATE INDEX IF NOT EXISTS idx_cue_company_capability
  ON public.customer_usage_events (company_id, capability);

-- §3 — daily/weekly/monthly bucketing scans on the pre-computed UTC day.
CREATE INDEX IF NOT EXISTS idx_cue_company_day
  ON public.customer_usage_events (company_id, event_day);
