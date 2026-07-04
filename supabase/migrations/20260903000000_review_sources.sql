-- BETA-REPORT-EXEC-003 — Canonical Review Ingestion (Trust Activation)
--
-- Durable store for AUTHENTICATED per-source review records — the raw store the canonical ReviewSourceLoader
-- reloads for the TrustCoherence ReviewAggregator (which re-consolidates them via the reputation bridge).
-- Intentionally separate from `provider_evidence`: that table holds CONSOLIDATED Evidence (lossy — per-source
-- ratings cannot be recovered), whereas the loader contract returns raw per-source payloads.
--
-- UNAPPLIED by default. Never apply to production without explicit authorization; apply to a non-prod project
-- to durably activate trust ingestion. Until applied, the guarded repository returns null and trust_coherence
-- falls back to today's behavior (zero regression).

create table if not exists review_sources (
  id                    uuid primary key default gen_random_uuid(),
  subject_id            text        not null,          -- normalized domain (preferred) or brand key
  source                text        not null,          -- free-form review-source key (google, trustpilot, g2, …)
  observed_at           timestamptz not null,          -- when this snapshot was observed (deterministic, supplied)
  average_rating        numeric,                        -- 0..5, nullable (only genuinely-supplied values)
  review_count          integer,
  verified_count        integer,
  recent_reviews        integer,
  sentiment_positive    integer,                        -- counts ONLY if the source supplied sentiment
  sentiment_neutral     integer,
  sentiment_negative    integer,
  owner_response_count  integer,
  response_rate         numeric,                        -- 0..1
  avg_response_hours    numeric,
  last_review_at        timestamptz,
  ingested_at           timestamptz not null default now(),
  unique (subject_id, source, observed_at)
);

create index if not exists review_sources_subject_observed_idx
  on review_sources (subject_id, observed_at desc);
