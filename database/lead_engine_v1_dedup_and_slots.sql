-- Lead engine: de-duplication, freshness, engagement, confidence, slot control.
-- Run after lead_engine_v1.sql. Safe for existing data.

-- 1) lead_signals_v1: content_hash for de-duplication (sha256(platform + normalized raw_text))
alter table lead_signals_v1 add column if not exists content_hash text null;
create unique index if not exists idx_lead_signals_company_content_hash
  on lead_signals_v1(company_id, content_hash) where content_hash is not null;

-- 2) lead_signals_v1: posted_at for freshness scoring
alter table lead_signals_v1 add column if not exists posted_at timestamptz null;

-- 3) lead_signals_v1: engagement_potential (LLM probability_of_response)
alter table lead_signals_v1 add column if not exists engagement_potential numeric default 0;

-- 4) lead_jobs_v1: confidence_index (0-100, like Trend engine)
alter table lead_jobs_v1 add column if not exists confidence_index integer default 0;

-- 5) lead_signals_v1: allow ARCHIVED for soft slot control (no check constraint on status)
-- Application sets status = 'ARCHIVED' for signals beyond top 50 per company.
