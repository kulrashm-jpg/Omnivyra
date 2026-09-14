-- ============================================================================
-- CPG-008 — evidence-state adjudication (closes B-16 / B-17 storage)
-- ============================================================================
--
-- ADDITIVE and IDEMPOTENT. Extends the CPG-005/007 tables; creates nothing new.
-- Rows written before CPG-008 keep evidence_state / adjudication_outcome NULL.
--
-- The rule that matters is enforced HERE, not only in code:
--   a field whose evidence is OBSERVED_ONLY or UNRESOLVED can never carry an
--   effective value, and an unresolved public conflict can never carry a winner.
-- So a weak parsed claim cannot become "the company's value" even through a
-- writer that bypasses the resolver.
--
-- NOT APPLIED TO PRODUCTION. Local, conclusively non-production database only.
-- ============================================================================

-- ── claims: the measure qualifier is part of comparability ───────────────────
alter table public.company_grounding_claims
  add column if not exists measure_qualifier text;

alter table public.company_grounding_claims
  drop constraint if exists chk_cgc_measure_qualifier,
  add constraint chk_cgc_measure_qualifier check (measure_qualifier is null
    or char_length(measure_qualifier) between 1 and 40);

-- Re-declared (from 20260911) to include measure_qualifier in the immutable set.
create or replace function public.company_grounding_claims_extraction_immutable()
returns trigger language plpgsql as $$
begin
  if new.extraction_statement is distinct from old.extraction_statement
     or new.temporal_type      is distinct from old.temporal_type
     or new.period_label       is distinct from old.period_label
     or new.period_year        is distinct from old.period_year
     or new.currency           is distinct from old.currency
     or new.approximation      is distinct from old.approximation
     or new.money_kind         is distinct from old.money_kind
     or new.extraction_method  is distinct from old.extraction_method
     or new.accepted_because   is distinct from old.accepted_because
     or new.discovery_provider is distinct from old.discovery_provider
     or new.discovery_query    is distinct from old.discovery_query
     or new.discovery_rank     is distinct from old.discovery_rank
     or new.measure_qualifier  is distinct from old.measure_qualifier then
    raise exception 'company_grounding_claims extraction provenance is immutable';
  end if;
  return new;
end $$;

-- ── fields: why the field has, or lacks, an effective value ──────────────────
alter table public.company_grounding_fields
  add column if not exists evidence_state          text,
  add column if not exists adjudication_outcome    text,
  add column if not exists adjudication_reason     text,
  add column if not exists requires_review         boolean not null default false,
  add column if not exists adjudication_candidates jsonb   not null default '[]'::jsonb;

alter table public.company_grounding_fields
  drop constraint if exists chk_cgf_evidence_state,
  add constraint chk_cgf_evidence_state check (evidence_state is null
    or evidence_state in ('EFFECTIVE','OBSERVED_ONLY','CONFLICTING','UNRESOLVED')),

  drop constraint if exists chk_cgf_adjudication_outcome,
  add constraint chk_cgf_adjudication_outcome check (adjudication_outcome is null or adjudication_outcome in (
    'USER_VALUE','USER_DECISION','SUFFICIENT_SINGLE_VALUE','WINNER_BY_EVIDENCE','WINNER_BY_AUTHORITY',
    'PUBLIC_CONFLICT_UNRESOLVED','INSUFFICIENT_EVIDENCE','AMBIGUOUS_MEASURE','NO_EVIDENCE','NOT_ADJUDICATED')),

  drop constraint if exists chk_cgf_adjudication_reason,
  add constraint chk_cgf_adjudication_reason check (adjudication_reason is null
    or char_length(adjudication_reason) between 1 and 4000),

  drop constraint if exists chk_cgf_adjudication_candidates,
  add constraint chk_cgf_adjudication_candidates check (jsonb_typeof(adjudication_candidates) = 'array'),

  -- state and outcome are written together or not at all
  drop constraint if exists chk_cgf_state_outcome_pair,
  add constraint chk_cgf_state_outcome_pair check ((evidence_state is null) = (adjudication_outcome is null)),

  -- B-17 at the database: observed-only / unresolved evidence is never effective
  drop constraint if exists chk_cgf_observed_not_effective,
  add constraint chk_cgf_observed_not_effective check (evidence_state is null
    or evidence_state not in ('OBSERVED_ONLY','UNRESOLVED') or effective_value is null),

  -- an EFFECTIVE field has a value
  drop constraint if exists chk_cgf_effective_has_value,
  add constraint chk_cgf_effective_has_value check (evidence_state is distinct from 'EFFECTIVE'
    or effective_value is not null),

  -- B-16 at the database: an unresolved public conflict has no winner and needs review
  drop constraint if exists chk_cgf_public_conflict_no_winner,
  add constraint chk_cgf_public_conflict_no_winner check (adjudication_outcome is distinct from 'PUBLIC_CONFLICT_UNRESOLVED'
    or (effective_value is null and requires_review and evidence_state = 'CONFLICTING'));

create index if not exists idx_cgf_company_review
  on public.company_grounding_fields (company_id, requires_review)
  where requires_review = true;

comment on column public.company_grounding_fields.evidence_state is
  'CPG-008: EFFECTIVE | OBSERVED_ONLY | CONFLICTING | UNRESOLVED. Observed-only/unresolved can never carry an effective value (CHECK).';
comment on column public.company_grounding_fields.adjudication_candidates is
  'CPG-008: every competing/observed value with families, authority, tier, freshness, entity match and strength. Strength is NOT a probability.';
