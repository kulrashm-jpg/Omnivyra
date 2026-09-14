-- ============================================================================
-- CPG-009 — deterministic entity identity (closes B-21 storage)
-- ============================================================================
--
-- ADDITIVE and IDEMPOTENT. Extends the CPG-005/007/008 tables; creates nothing
-- new; rewrites no prior observation. Rows written before CPG-009 keep the new
-- claim columns NULL / '[]' and identity_families 0.
--
-- What a future audit must be able to reconstruct: WHY was this document
-- attributed to this company? Each claim now stores
--   · the document's own provenance — the host it came from, the publisher's
--     name (kept apart from the subject), and the identity statements found in
--     it (IMMUTABLE, like all extraction provenance);
--   · the identity decision made from them — class, reason and the signals
--     weighed (re-evaluated on re-observation, as entity match always was).
--
-- The rule that matters is enforced HERE, not only in code:
--   a field cannot be stored PUBLICLY_VERIFIED unless at least one independent
--   family supporting its value DECISIVELY establishes the company's identity.
-- It is added NOT VALID: it binds every new or updated row, without failing
-- legacy rows retroactively.
--
-- NOT APPLIED TO PRODUCTION. Local, conclusively non-production database only.
-- ============================================================================

-- ── claims: document identity provenance + the claim's own identity decision ─
alter table public.company_grounding_claims
  add column if not exists source_host       text,
  add column if not exists publisher         text,
  add column if not exists identity_evidence jsonb not null default '[]'::jsonb,
  add column if not exists identity_class    text,
  add column if not exists identity_reason   text,
  add column if not exists identity_signals  jsonb not null default '[]'::jsonb;

alter table public.company_grounding_claims
  drop constraint if exists chk_cgc_identity_class,
  add constraint chk_cgc_identity_class check (identity_class is null
    or identity_class in ('DECISIVE','SUPPORTING','WEAK','MISMATCH','UNKNOWN')),

  drop constraint if exists chk_cgc_identity_reason,
  add constraint chk_cgc_identity_reason check (identity_reason is null
    or char_length(identity_reason) between 1 and 2000),

  -- a decision always carries its reason, and a reason only exists with a decision
  drop constraint if exists chk_cgc_identity_decided,
  add constraint chk_cgc_identity_decided check ((identity_class is null) = (identity_reason is null)),

  drop constraint if exists chk_cgc_identity_evidence_array,
  add constraint chk_cgc_identity_evidence_array check (jsonb_typeof(identity_evidence) = 'array'),

  drop constraint if exists chk_cgc_identity_signals_array,
  add constraint chk_cgc_identity_signals_array check (jsonb_typeof(identity_signals) = 'array'),

  drop constraint if exists chk_cgc_source_host,
  add constraint chk_cgc_source_host check (source_host is null or char_length(source_host) between 1 and 255),

  drop constraint if exists chk_cgc_publisher,
  add constraint chk_cgc_publisher check (publisher is null or char_length(publisher) <= 300);

-- Re-declared (from 20260912) to add the document's identity provenance to the
-- immutable set. The identity DECISION columns are deliberately NOT included.
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
     or new.measure_qualifier  is distinct from old.measure_qualifier
     or new.source_host        is distinct from old.source_host
     or new.publisher          is distinct from old.publisher
     or new.identity_evidence  is distinct from old.identity_evidence then
    raise exception 'company_grounding_claims extraction provenance is immutable';
  end if;
  return new;
end $$;

-- ── fields: identity corroboration behind the effective value ────────────────
alter table public.company_grounding_fields
  add column if not exists identity_families integer not null default 0;

alter table public.company_grounding_fields
  drop constraint if exists chk_cgf_identity_families,
  add constraint chk_cgf_identity_families check (identity_families >= 0);

-- B-21 at the database: no verified field without decisively-identified support.
alter table public.company_grounding_fields
  drop constraint if exists chk_cgf_verified_requires_identity;
alter table public.company_grounding_fields
  add constraint chk_cgf_verified_requires_identity
  check (status <> 'PUBLICLY_VERIFIED' or identity_families >= 1) not valid;

comment on column public.company_grounding_claims.identity_evidence is
  'CPG-009: identity statements found IN the document (website, registry id, LinkedIn, relationships). Immutable provenance.';
comment on column public.company_grounding_claims.identity_class is
  'CPG-009: DECISIVE | SUPPORTING | WEAK | MISMATCH | UNKNOWN — strength of evidence that this document is about this company. Not a probability.';
comment on column public.company_grounding_fields.identity_families is
  'CPG-009: independent families supporting the effective value whose documents DECISIVELY establish identity. PUBLICLY_VERIFIED requires >= 1.';
