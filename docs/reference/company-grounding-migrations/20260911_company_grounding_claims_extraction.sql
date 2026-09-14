-- ============================================================================
-- CPG-007 — source-derived value extraction provenance (closes B-15 storage)
-- ============================================================================
--
-- ADDITIVE ONLY. Nullable columns on public.company_grounding_claims (created by
-- 20260910_company_profile_grounding_claims.sql). Every existing row, and every
-- claim from a non-extraction source, keeps all of these NULL.
--
-- WHY THESE ARE COLUMNS, NOT JSON: temporal type and money kind change what a
-- value MEANS ("revenue was $500M" vs "revenue will reach $1B"). They must be
-- constrained and queryable, not an opaque blob that could drift.
--
-- NOT APPLIED TO PRODUCTION. Applied only to the local, conclusively
-- non-production database used for CPG-005A/007 verification.
-- ============================================================================

alter table public.company_grounding_claims
  add column if not exists extraction_statement text,
  add column if not exists temporal_type        text,
  add column if not exists period_label         text,
  add column if not exists period_year          integer,
  add column if not exists currency             text,
  add column if not exists approximation        boolean,
  add column if not exists money_kind           text,
  add column if not exists extraction_method    text,
  add column if not exists accepted_because     text,
  -- §19: how public-web search surfaced the document. Rank is audit-only.
  add column if not exists discovery_provider   text,
  add column if not exists discovery_query      text,
  add column if not exists discovery_rank       integer;

-- ── value-domain checks ─────────────────────────────────────────────────────
alter table public.company_grounding_claims
  drop constraint if exists chk_cgc_temporal_type,
  add constraint chk_cgc_temporal_type check (temporal_type is null
    or temporal_type in ('CURRENT','HISTORICAL','FORECAST','TARGET','UNKNOWN')),

  drop constraint if exists chk_cgc_money_kind,
  add constraint chk_cgc_money_kind check (money_kind is null or money_kind in (
    'revenue','revenue_range','arr','valuation','funding','order_book','gmv',
    'bookings','market_size','acquisition_price','investment','unknown')),

  drop constraint if exists chk_cgc_extraction_method,
  add constraint chk_cgc_extraction_method check (extraction_method is null
    or extraction_method in ('json_ld','explicit_statement')),

  drop constraint if exists chk_cgc_currency,
  add constraint chk_cgc_currency check (currency is null or currency ~ '^[A-Z]{3}$'),

  drop constraint if exists chk_cgc_period_year,
  add constraint chk_cgc_period_year check (period_year is null or period_year between 1800 and 2200),

  drop constraint if exists chk_cgc_period_label,
  add constraint chk_cgc_period_label check (period_label is null or char_length(period_label) <= 32),

  drop constraint if exists chk_cgc_extraction_statement,
  add constraint chk_cgc_extraction_statement check (extraction_statement is null
    or char_length(extraction_statement) between 1 and 1000),

  drop constraint if exists chk_cgc_accepted_because,
  add constraint chk_cgc_accepted_because check (accepted_because is null
    or char_length(accepted_because) <= 500),

  drop constraint if exists chk_cgc_discovery_query,
  add constraint chk_cgc_discovery_query check (discovery_query is null
    or char_length(discovery_query) between 1 and 500),

  drop constraint if exists chk_cgc_discovery_rank,
  add constraint chk_cgc_discovery_rank check (discovery_rank is null or discovery_rank >= 1),

  -- Discovery provenance is all-or-nothing, like extraction provenance.
  drop constraint if exists chk_cgc_discovery_complete,
  add constraint chk_cgc_discovery_complete check (
    (discovery_provider is null and discovery_query is null and discovery_rank is null)
    or (discovery_provider is not null and discovery_query is not null and discovery_rank is not null)
  );

-- ── coherence: extraction provenance is all-or-nothing ──────────────────────
-- A row either came from the extractor (method, statement, temporal type and
-- the accept reason all present) or it did not (all absent). A half-populated
-- row would claim an origin it cannot prove.
alter table public.company_grounding_claims
  drop constraint if exists chk_cgc_extraction_complete,
  add constraint chk_cgc_extraction_complete check (
    (extraction_method is null and extraction_statement is null
      and temporal_type is null and accepted_because is null and approximation is null)
    or
    (extraction_method is not null and extraction_statement is not null
      and temporal_type is not null and accepted_because is not null and approximation is not null)
  );

-- ── §6 structural bar, enforced by the database ─────────────────────────────
-- A FORECAST or TARGET may never be stored as a current-state money value.
-- The extractor already rejects these; this makes the rule hold even for a
-- writer that bypasses the extractor.
alter table public.company_grounding_claims
  drop constraint if exists chk_cgc_no_forward_money,
  add constraint chk_cgc_no_forward_money check (
    temporal_type is null
    or temporal_type not in ('FORECAST','TARGET')
    or field not in ('revenue','annual_revenue','turnover','funding')
  );

-- ── immutability of extraction provenance ───────────────────────────────────
-- Re-observation (ON CONFLICT) updates bookkeeping only. What a document SAID
-- and how it was read must never be rewritten afterwards.
create or replace function public.company_grounding_claims_extraction_immutable()
returns trigger language plpgsql as $$
begin
  if new.extraction_statement is distinct from old.extraction_statement
     or new.temporal_type     is distinct from old.temporal_type
     or new.period_label      is distinct from old.period_label
     or new.period_year       is distinct from old.period_year
     or new.currency          is distinct from old.currency
     or new.approximation     is distinct from old.approximation
     or new.money_kind        is distinct from old.money_kind
     or new.extraction_method is distinct from old.extraction_method
     or new.accepted_because  is distinct from old.accepted_because
     or new.discovery_provider is distinct from old.discovery_provider
     or new.discovery_query   is distinct from old.discovery_query
     or new.discovery_rank    is distinct from old.discovery_rank then
    raise exception 'company_grounding_claims extraction provenance is immutable';
  end if;
  return new;
end $$;

drop trigger if exists trg_cgc_extraction_immutable on public.company_grounding_claims;
create trigger trg_cgc_extraction_immutable before update on public.company_grounding_claims
  for each row execute function public.company_grounding_claims_extraction_immutable();

comment on column public.company_grounding_claims.temporal_type is
  'CPG-007: CURRENT/HISTORICAL/FORECAST/TARGET/UNKNOWN as stated by the source. FORECAST/TARGET barred for money fields.';
comment on column public.company_grounding_claims.extraction_statement is
  'CPG-007: verbatim sentence the value was read from. Never paraphrased. Immutable.';
