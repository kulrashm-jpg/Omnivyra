-- Phase 4 — Durable Canonical Lead Intelligence store (ADDITIVE ONLY).
-- Creates two NEW tables; modifies/migrates NOTHING existing. Existing lead tables
-- (leads, active_leads, canonical_leads, lead_signals, opportunity_feed_items,
-- marketpulse_signals, …) are untouched. The canonical record is upserted
-- idempotently on (company_id, dedupe_key); per-ingestion provenance lives in the
-- events table so source history is preserved. RLS mirrors the existing service-role
-- pattern; tenant isolation is enforced by company_id + RLS.

CREATE TABLE IF NOT EXISTS lead_intelligence (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       text NOT NULL,
  dedupe_key       text NOT NULL,
  source           text NOT NULL,
  unified_person_id text,
  status           text,
  scores           jsonb NOT NULL DEFAULT '{}'::jsonb,
  identity         jsonb NOT NULL DEFAULT '{}'::jsonb,
  attribution      jsonb NOT NULL DEFAULT '{}'::jsonb,
  campaign         jsonb NOT NULL DEFAULT '{}'::jsonb,
  content          jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_table     text,
  source_id        text,
  occurred_at      timestamptz,
  ingested_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_intelligence_dedupe_unique UNIQUE (company_id, dedupe_key),
  CONSTRAINT lead_intelligence_source_not_blank CHECK (length(btrim(source)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_lead_intelligence_company_source ON lead_intelligence (company_id, source);
CREATE INDEX IF NOT EXISTS idx_lead_intelligence_company_person ON lead_intelligence (company_id, unified_person_id);
CREATE INDEX IF NOT EXISTS idx_lead_intelligence_company_occurred ON lead_intelligence (company_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS lead_intelligence_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  text NOT NULL,
  lead_id     uuid NOT NULL REFERENCES lead_intelligence (id) ON DELETE CASCADE,
  origin      text NOT NULL,
  source      text NOT NULL,
  entity_id   text,
  event_type  text NOT NULL,
  occurred_at timestamptz,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_intelligence_events_lead ON lead_intelligence_events (company_id, lead_id, occurred_at DESC);

ALTER TABLE lead_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_intelligence_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY lead_intelligence_service_role ON lead_intelligence FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY lead_intelligence_events_service_role ON lead_intelligence_events FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
